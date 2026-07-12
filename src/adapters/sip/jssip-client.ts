import { UA, WebSocketInterface } from "jssip";
import type { RTCSession } from "jssip/lib/RTCSession";
import type { IncomingCall } from "@/domain/entities";
import type {
  SoftphoneConfig,
  SoftphoneEvents,
  SoftphonePort,
} from "@/domain/softphone.port";

function buildSipUri(userOrDest: string, domain: string): string {
  const value = userOrDest.trim();

  if (!value) {
    throw new Error("SIP user/destination is empty");
  }

  if (value.startsWith("sip:")) {
    return value;
  }

  if (value.includes("@")) {
    return `sip:${value}`;
  }

  const host = domain.trim();

  if (!host) {
    throw new Error("SIP domain is empty");
  }

  return `sip:${value}@${host}`;
}

function mediaConstraints(audioInputDeviceId?: string): MediaStreamConstraints {
  return {
    audio: audioInputDeviceId
      ? { deviceId: { exact: audioInputDeviceId } }
      : true,
    video: false,
  };
}

export class JsSipClient implements SoftphonePort {
  private readonly cfg: SoftphoneConfig;
  private readonly events: SoftphoneEvents;
  private ua: UA | null = null;
  private session: RTCSession | null = null;
  private localStream: MediaStream | null = null;

  constructor(cfg: SoftphoneConfig, events: SoftphoneEvents) {
    this.cfg = cfg;
    this.events = events;
  }

  async connect(): Promise<void> {
    this.disconnectUaOnly();

    const user = this.cfg.username.trim();
    const domain = this.cfg.domain.trim();
    const wsUrl = this.cfg.websocketUrl.trim();

    if (!wsUrl) {
      this.events.onRegistrationState("failed", "websocket url is empty");
      this.events.onLog("cannot register: websocket url is empty");
      return;
    }
    if (!user) {
      this.events.onRegistrationState("failed", "username is empty");
      this.events.onLog("cannot register: username is empty");
      return;
    }
    if (!domain) {
      this.events.onRegistrationState("failed", "domain is empty");
      this.events.onLog("cannot register: domain is empty (required for SIP AOR)");
      return;
    }
    if (!this.cfg.password.trim()) {
      this.events.onRegistrationState("failed", "password is empty");
      this.events.onLog("cannot register: password is empty");
      return;
    }

    const uri = buildSipUri(user, domain);
    const socket = new WebSocketInterface(wsUrl);

    this.events.onRegistrationState("connecting");
    this.events.onLog(`SIP websocket ${wsUrl}`);
    this.events.onLog(`SIP AOR ${uri}`);

    const ua = new UA({
      sockets: [socket],
      uri,
      password: this.cfg.password,
      authorization_user: user,
      display_name: this.cfg.callerIdName || user,
      register: true,
      session_timers: false,
    });

    ua.on("connecting", () => {
      this.events.onLog("SIP transport connecting");
    });

    ua.on("connected", () => {
      this.events.onLog("SIP transport connected");
    });

    ua.on("disconnected", (data) => {
      this.events.onRegistrationState("disconnected");
      this.events.onCallState("idle");
      this.cleanupSession();
      this.events.onLog(
        `SIP transport disconnected error=${String(data.error)} code=${data.code ?? "n/a"} reason=${data.reason ?? "n/a"}`,
      );
    });

    ua.on("registered", () => {
      this.events.onRegistrationState("registered");
      this.events.onLog("SIP registered");
    });

    ua.on("unregistered", (data) => {
      this.events.onRegistrationState("disconnected");
      this.events.onLog(`SIP unregistered cause=${data.cause ?? "n/a"}`);
    });

    ua.on("registrationFailed", (data) => {
      const detail = `${data.cause ?? "registration failed"}`;
      this.events.onRegistrationState("failed", detail);
      this.events.onLog(`SIP registration failed: ${detail}`);
    });

    ua.on("newRTCSession", (data: { originator: string; session: RTCSession }) => {
      const session = data.session;

      if (data.originator === "remote") {
        this.attachSession(session, "inbound");
        const remote = session.remote_identity;
        const callerNumber = remote?.uri?.user || "Unknown";
        const callerName = remote?.display_name || callerNumber;
        const incoming: IncomingCall = {
          callId: session.id,
          callerName,
          callerNumber,
          sdp: "",
        };
        this.events.onCallState("ringing");
        this.events.onIncomingCall(incoming);
        this.events.onLog(`SIP incoming ${callerNumber}`);
        return;
      }

      this.attachSession(session, "outbound");
    });

    this.ua = ua;
    ua.start();
  }

  disconnect(): void {
    this.hangup();
    this.disconnectUaOnly();
  }

  async call(destination: string): Promise<void> {
    if (!this.ua) {
      throw new Error("SIP UA not started");
    }

    const target = buildSipUri(destination, this.cfg.domain);
    this.events.onLog(`SIP INVITE ${target}`);
    this.events.onCallState("dialing");

    this.ua.call(target, {
      mediaConstraints: mediaConstraints(this.cfg.audioInputDeviceId),
      pcConfig: { iceServers: [] },
      eventHandlers: {
        peerconnection: (e) => {
          this.bindPeerConnection(e.peerconnection);
        },
        progress: () => {
          this.events.onCallState("early-media");
        },
        accepted: () => {
          this.events.onCallState("active");
        },
        confirmed: () => {
          this.events.onCallState("active");
        },
        failed: (e) => {
          this.events.onLog(`SIP call failed: ${e.cause ?? "failed"}`);
          this.cleanupSession();
          this.events.onCallState("idle");
        },
        ended: (e) => {
          this.events.onLog(`SIP call ended: ${e.cause ?? "ended"}`);
          this.cleanupSession();
          this.events.onCallState("idle");
        },
      },
    });
  }

  async answer(): Promise<void> {
    if (!this.session) {
      return;
    }

    this.session.answer({
      mediaConstraints: mediaConstraints(this.cfg.audioInputDeviceId),
      pcConfig: { iceServers: [] },
    });
    this.events.onCallState("active");
  }

  hangup(): void {
    if (!this.session) {
      this.events.onCallState("idle");
      return;
    }

    this.events.onLog(`SIP hangup session=${this.session.id}`);

    try {
      this.session.terminate();
    } catch (error) {
      this.events.onLog(`SIP terminate failed: ${String(error)}`);
    }

    this.cleanupSession();
    this.events.onCallState("idle");
  }

  setMuted(muted: boolean): void {
    if (!this.session) {
      this.localStream?.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
      return;
    }

    if (muted) {
      this.session.mute({ audio: true });
    } else {
      this.session.unmute({ audio: true });
    }
  }

  sendDtmf(digit: string): boolean {
    const d = digit.trim();

    if (!/^[\d*#]$/.test(d)) {
      this.events.onLog("dtmf ignored: need one of 0-9 * #");
      return false;
    }

    if (!this.session) {
      this.events.onLog("dtmf ignored: no call");
      return false;
    }

    try {
      this.session.sendDTMF(d);
      this.events.onLog(`dtmf ${d}`);
      return true;
    } catch (error) {
      this.events.onLog(`dtmf failed: ${String(error)}`);
      return false;
    }
  }

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

  canSendDtmf(): boolean {
    return this.session !== null && !this.session.isEnded();
  }

  private attachSession(session: RTCSession, direction: "inbound" | "outbound"): void {
    if (this.session && this.session !== session) {
      try {
        this.session.terminate();
      } catch {
        // ignore
      }
    }

    this.session = session;
    this.events.onLog(`SIP session ${direction} id=${session.id}`);

    session.on("peerconnection", (e) => {
      this.bindPeerConnection(e.peerconnection);
    });

    if (session.connection) {
      this.bindPeerConnection(session.connection);
    }

    session.on("accepted", () => {
      this.events.onCallState("active");
    });

    session.on("confirmed", () => {
      this.events.onCallState("active");
    });

    session.on("ended", (e) => {
      this.events.onLog(`SIP session ended: ${e.cause ?? "ended"}`);
      this.cleanupSession();
      this.events.onCallState("idle");
    });

    session.on("failed", (e) => {
      this.events.onLog(`SIP session failed: ${e.cause ?? "failed"}`);
      this.cleanupSession();
      this.events.onCallState("idle");
    });
  }

  private bindPeerConnection(pc: RTCPeerConnection): void {
    pc.addEventListener("track", (event) => {
      const [stream] = event.streams;

      if (stream) {
        this.events.onRemoteStream(stream);
      }
    });

    pc.getReceivers().forEach((receiver) => {
      if (receiver.track && receiver.track.kind === "audio") {
        this.events.onRemoteStream(new MediaStream([receiver.track]));
      }
    });
  }

  private cleanupSession(): void {
    this.session = null;
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
  }

  private disconnectUaOnly(): void {
    if (!this.ua) {
      return;
    }

    try {
      this.ua.stop();
    } catch (error) {
      this.events.onLog(`SIP UA stop failed: ${String(error)}`);
    }

    this.ua = null;
  }
}
