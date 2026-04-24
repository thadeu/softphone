export type RegistrationState =
  | "disconnected"
  | "connecting"
  | "registered"
  | "failed";

export type CallState =
  | "idle"
  | "dialing"
  | "ringing"
  | "early-media"
  | "active";

export type IncomingCall = {
  callId: string;
  callerName: string;
  callerNumber: string;
  sdp: string;
};

export type VertoConfig = {
  websocketUrl: string;
  domain: string;
  username: string;
  password: string;
  callerIdName?: string;
  /**
   * When false (default), login is sent as `user@domain`.
   * When true, login is only `user` (some directory setups match this better).
   */
  loginUserOnly?: boolean;
  audioInputDeviceId?: string;
};

export type VertoEvents = {
  onRegistrationState: (state: RegistrationState, reason?: string) => void;
  onCallState: (state: CallState, reason?: string) => void;
  onIncomingCall: (call: IncomingCall) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onLog: (line: string) => void;
};

type JsonRpcMessage = {
  jsonrpc: "2.0";
  method?: string;
  params?: Record<string, unknown>;
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
};

const randomId = () => crypto.randomUUID();

/**
 * FreeSWITCH/mod_verto INVITE SDP often includes telecom-only attributes (e.g. a=silenceSupp)
 * and/or a bare a=sendrecv that Chromium rejects with "Invalid SDP line". Unified Plan also
 * requires a=mid on each m-line; omitting it can surface as misleading parse errors.
 */
function sanitizeVertoInboundOfferSdp(sdp: string): string {
  const lines = sdp
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.length > 0);

  const stripped = lines.filter((line) => {
    if (/^a=silenceSupp:/i.test(line)) {
      return false;
    }
    if (/^a=sendrecv\s*$/i.test(line)) {
      return false;
    }
    return true;
  });

  const out: string[] = [];
  for (let i = 0; i < stripped.length; i++) {
    const line = stripped[i];
    out.push(line);
    if (/^m=audio/i.test(line)) {
      let hasMid = false;
      for (let j = i + 1; j < stripped.length && !stripped[j].startsWith("m="); j++) {
        if (/^a=mid:/i.test(stripped[j])) {
          hasMid = true;
          break;
        }
      }
      if (!hasMid) {
        out.push("a=mid:0");
      }
    }
  }

  return out.join("\r\n") + "\r\n";
}

export class VertoClient {
  private ws: WebSocket | null = null;
  private readonly cfg: VertoConfig;
  private readonly events: VertoEvents;
  private readonly sessid: string;
  private rpcId = 0;
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private currentCallId: string | null = null;
  private pendingIncomingCall: IncomingCall | null = null;
  private readonly pendingRequests = new Map<number, string>();

  constructor(cfg: VertoConfig, events: VertoEvents) {
    this.cfg = cfg;
    this.events = events;
    this.sessid = randomId();
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      return;
    }

    const user = this.cfg.username.trim();
    const domain = this.cfg.domain.trim();
    const pass = this.cfg.password;

    if (!user) {
      this.events.onRegistrationState("failed", "username is empty");
      this.events.onLog("cannot login: username is empty");
      return;
    }
    if (!this.cfg.loginUserOnly && !domain) {
      this.events.onRegistrationState("failed", "domain is empty");
      this.events.onLog("cannot login: domain is empty");
      return;
    }
    if (!pass.trim()) {
      this.events.onRegistrationState("failed", "password is empty");
      this.events.onLog(
        "cannot login: password is empty — FS usually still returns -32001 Authentication Failure, which is misleading",
      );
      return;
    }

    this.events.onRegistrationState("connecting");
    this.ws = new WebSocket(this.cfg.websocketUrl);
    this.ws.onopen = () => {
      this.events.onLog("WebSocket connected");
      const loginStr = this.cfg.loginUserOnly
        ? user
        : `${user}@${domain}`;
      this.events.onLog(`login string: ${loginStr}`);
      this.send("login", {
        login: loginStr,
        passwd: this.cfg.password,
        sessid: this.sessid,
        userVariables: {},
        loginParams: {},
      });
    };
    this.ws.onclose = (evt) => {
      this.events.onRegistrationState("disconnected");
      this.events.onCallState("idle");
      this.cleanupPeer();
      this.events.onLog(`WebSocket disconnected (code=${evt.code} reason=${evt.reason || "n/a"} clean=${evt.wasClean})`);
    };
    this.ws.onerror = () => {
      this.events.onRegistrationState("failed", "websocket error");
      this.events.onLog("WebSocket error");
    };
    this.ws.onmessage = async (evt) => {
      const data = JSON.parse(String(evt.data)) as JsonRpcMessage;
      await this.handleMessage(data);
    };
  }

  disconnect(): void {
    this.hangup();
    this.ws?.close();
    this.ws = null;
  }

  async call(destination: string): Promise<void> {
    const to = destination.trim();
    if (!to) {
      return;
    }
    const pc = await this.ensurePeerConnection();
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });
    await pc.setLocalDescription(offer);
    await this.waitIceGatheringComplete(pc);

    const callId = randomId();
    this.currentCallId = callId;
    const sdp = pc.localDescription?.sdp ?? offer.sdp;
    if (!sdp) {
      throw new Error("Missing local SDP offer");
    }

    this.send("verto.invite", {
      sessid: this.sessid,
      sdp,
      dialogParams: {
        callID: callId,
        destination_number: to,
        caller_id_name: this.cfg.callerIdName || this.cfg.username,
        caller_id_number: this.cfg.username,
        useVideo: false,
        useStereo: false,
      },
    });
    this.events.onCallState("dialing");
  }

  async answer(): Promise<void> {
    if (!this.pendingIncomingCall) {
      return;
    }
    const incoming = this.pendingIncomingCall;
    const pc = await this.ensurePeerConnection();
    const offerSdp = sanitizeVertoInboundOfferSdp(incoming.sdp);
    await pc.setRemoteDescription({
      type: "offer",
      sdp: offerSdp,
    });
    const answer = await pc.createAnswer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });
    await pc.setLocalDescription(answer);
    await this.waitIceGatheringComplete(pc);

    const sdp = pc.localDescription?.sdp ?? answer.sdp;
    if (!sdp) {
      throw new Error("Missing local SDP answer");
    }
    this.pendingIncomingCall = null;
    this.currentCallId = incoming.callId;
    this.send("verto.answer", {
      sessid: this.sessid,
      sdp,
      dialogParams: {
        callID: incoming.callId,
      },
    });
    this.events.onCallState("active");
  }

  hangup(): void {
    const dialogId = this.currentCallId ?? this.pendingIncomingCall?.callId;
    this.events.onLog(`hangup() called dialogId=${dialogId ?? "none"}`);
    if (dialogId) {
      this.send("verto.bye", {
        sessid: this.sessid,
        dialogParams: {
          callID: dialogId,
        },
      });
    }
    this.currentCallId = null;
    this.pendingIncomingCall = null;
    this.cleanupPeer();
    this.events.onCallState("idle");
  }

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  /**
   * Outbound DTMF (RFC2833 / in-band per channel config) via mod_verto `verto.info`.
   * Single digit 0-9, * or # per call (IVR typically expects one digit at a time).
   */
  sendDtmf(digit: string): boolean {
    const d = digit.trim();
    if (!/^[\d*#]$/.test(d)) {
      this.events.onLog("dtmf ignored: need one of 0-9 * #");
      return false;
    }
    const callID = this.dialogCallId();
    if (!callID) {
      this.events.onLog("dtmf ignored: no call");
      return false;
    }
    this.send("verto.info", {
      sessid: this.sessid,
      dtmf: d,
      dialogParams: {
        callID,
      },
    });
    this.events.onLog(`dtmf ${d}`);
    return true;
  }

  /**
   * Sends each DTMF symbol in order (e.g. *961001#) with a short gap between tones
   * so the switch can parse feature codes reliably.
   */
  async sendDtmfSequence(sequence: string, gapMs = 110): Promise<void> {
    for (const char of sequence) {
      const d = char.trim();
      if (!/^[\d*#]$/.test(d)) {
        continue;
      }
      this.sendDtmf(d);
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }

  /** True when a dialog exists (outbound, answered inbound, or ringing inbound). */
  canSendDtmf(): boolean {
    return this.dialogCallId() !== null;
  }

  private dialogCallId(): string | null {
    if (this.currentCallId) {
      return this.currentCallId;
    }
    if (this.pendingIncomingCall?.callId) {
      return this.pendingIncomingCall.callId;
    }
    return null;
  }

  private send(method: string, params: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.rpcId += 1;
    const payload: JsonRpcMessage = {
      jsonrpc: "2.0",
      method,
      params,
      id: this.rpcId,
    };
    this.pendingRequests.set(this.rpcId, method);
    this.ws.send(JSON.stringify(payload));
  }

  private async ensurePeerConnection(): Promise<RTCPeerConnection> {
    if (this.pc) {
      return this.pc;
    }
    const preferredId = this.cfg.audioInputDeviceId;
    let stream: MediaStream | null = null;
    if (preferredId) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: preferredId } },
          video: false,
        });
      } catch {
        this.events.onLog("preferred mic unavailable, falling back to default");
      }
    }
    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    }
    this.localStream = stream;
    const pc = new RTCPeerConnection();
    this.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, this.localStream as MediaStream);
    });
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        this.events.onRemoteStream(stream);
      }
    };
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      this.events.onLog(`pc connectionState=${pc.connectionState}`);
      if (pc.connectionState === "connected") {
        this.events.onCallState("active");
      }
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected" ||
        pc.connectionState === "closed"
      ) {
        this.events.onCallState("idle");
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (!pc) return;
      this.events.onLog(`pc iceConnectionState=${pc.iceConnectionState}`);
    };
    this.pc = pc;
    return pc;
  }

  private async handleMessage(msg: JsonRpcMessage): Promise<void> {
    if (typeof msg.id === "number") {
      const method = this.pendingRequests.get(msg.id);
      this.pendingRequests.delete(msg.id);
      if (method === "login") {
        if (msg.error) {
          const code = msg.error.code ?? "";
          const detail = `${msg.error.message} (code ${code})`;
          this.events.onRegistrationState("failed", detail);
          this.events.onLog(`login failed: ${detail}`);
          this.events.onLog(`login raw: ${JSON.stringify(msg)}`);
        } else {
          this.events.onRegistrationState("registered");
          this.events.onLog(`login success: ${JSON.stringify(msg.result ?? msg)}`);
        }
      } else if (method === "verto.info" && msg.error) {
        this.events.onLog(`verto.info failed: ${msg.error.message}`);
      }
    }
    if (msg.error && msg.method) {
      this.events.onLog(`${msg.method} error: ${msg.error.message}`);
      return;
    }
    if (!msg.method) {
      return;
    }
    const params = msg.params || {};
    switch (msg.method) {
      case "verto.invite": {
        const p = params as Record<string, unknown>;
        const dialog = (p.dialogParams ?? {}) as Record<string, unknown>;
        // FS often sends callID and SDP at params top level; some builds nest under dialogParams.
        const callId = String(
          dialog.callID ?? p.callID ?? "",
        ).trim();
        const sdp = String(p.sdp ?? "").trim();
        if (!callId || !sdp) {
          this.events.onLog(
            "verto.invite ignored: missing callID or sdp (check dialogParams vs top-level params)",
          );
          return;
        }
        const callerName = String(
          dialog.caller_id_name ?? p.caller_id_name ?? "Unknown",
        );
        const callerNumber = String(
          dialog.caller_id_number ?? p.caller_id_number ?? "Unknown",
        );
        this.pendingIncomingCall = {
          callId,
          sdp,
          callerName,
          callerNumber,
        };
        this.events.onCallState("ringing");
        this.events.onIncomingCall(this.pendingIncomingCall);
        break;
      }
      case "verto.media": {
        const sdp = String(params.sdp ?? "");
        if (!sdp) return;
        const pc = await this.ensurePeerConnection();
        await pc.setRemoteDescription({ type: "answer", sdp });
        this.events.onCallState("early-media");
        break;
      }
      case "verto.answer": {
        const sdp = String(params.sdp ?? "");
        if (!sdp) {
          this.events.onCallState("active");
          return;
        }
        const pc = await this.ensurePeerConnection();
        await pc.setRemoteDescription({ type: "answer", sdp });
        this.events.onCallState("active");
        break;
      }
      case "verto.bye": {
        const dialog = (params.dialogParams ?? {}) as Record<string, unknown>;
        const byeCallId = String(dialog.callID ?? (params as Record<string, unknown>).callID ?? "").trim();
        const activeCallId = this.dialogCallId();
        if (byeCallId && activeCallId && byeCallId !== activeCallId) {
          this.events.onLog(`verto.bye ignored: callID ${byeCallId} does not match active ${activeCallId}`);
          break;
        }
        this.events.onLog("Remote hangup");
        this.hangup();
        break;
      }
      case "verto.clientReady":
        this.events.onRegistrationState("registered");
        this.events.onLog("verto client ready");
        break;
      case "verto.ping":
        this.send("verto.ping", { sessid: this.sessid });
        break;
      default:
        this.events.onLog(`Unhandled method: ${msg.method}`);
    }
  }

  private cleanupPeer(): void {
    this.pc?.getSenders().forEach((sender) => sender.track?.stop());
    this.pc?.close();
    this.pc = null;
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
  }

  private waitIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === "complete") {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pc.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      }, 1500);
      const onChange = () => {
        if (pc.iceGatheringState !== "complete") return;
        clearTimeout(timeout);
        pc.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      };
      pc.addEventListener("icegatheringstatechange", onChange);
    });
  }
}
