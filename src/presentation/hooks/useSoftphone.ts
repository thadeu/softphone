import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CallRecord,
  CallState,
  IncomingCall,
  RegistrationState,
  SoftphoneSettings,
} from "@/domain/entities";
import type { SoftphonePort } from "@/domain/softphone.port";
import { VertoClient } from "@/adapters/verto/verto-client";
import { callHistory } from "@/adapters/persistence/dexie-call-history";
import {
  defaultSettings,
  hasPersistedSession,
  loadSettings,
  sessionStore,
  writeMedia,
} from "@/adapters/persistence/local-session-store";
import { IncomingRingTone } from "@/adapters/audio/ring-tone";
import { registerSession } from "@/application/register-session";
import { disconnectSession } from "@/application/disconnect-session";
import { placeCall as placeCallUseCase } from "@/application/place-call";
import { answerCall as answerCallUseCase } from "@/application/answer-call";
import { hangupCall } from "@/application/hangup-call";
import { sendDtmf, sendDtmfSequence } from "@/application/send-dtmf";
import { listCallHistory } from "@/application/list-call-history";
import { recordCall } from "@/application/record-call";

let persistedSessionAutoConnectStarted = false;

export function useSoftphone() {
  const [settings, setSettings] = useState<SoftphoneSettings>(loadSettings);
  const [registrationState, setRegistrationState] =
    useState<RegistrationState>("disconnected");
  const [callState, setCallState] = useState<CallState>("idle");
  const [number, setNumber] = useState("");
  const [muted, setMuted] = useState(false);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [recentCalls, setRecentCalls] = useState<CallRecord[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const clientRef = useRef<SoftphonePort | null>(null);
  const ringRef = useRef<IncomingRingTone | null>(null);
  const accountKeyRef = useRef("");

  const accountKey = useMemo(
    () =>
      settings.loginUserOnly
        ? settings.username.trim()
        : `${settings.username.trim()}@${settings.domain.trim()}`,
    [settings.username, settings.domain, settings.loginUserOnly],
  );

  accountKeyRef.current = accountKey;

  const inCall =
    callState === "dialing" || callState === "early-media" || callState === "active";
  const isRegistered = registrationState === "registered";

  const appendLog = useCallback((line: string) => {
    setLogs((prev) =>
      [...prev, new Date().toLocaleTimeString() + " " + line].slice(-200),
    );
  }, []);

  const loadHistory = useCallback(async (account: string) => {
    const rows = await listCallHistory(callHistory, account, 50);
    setRecentCalls(rows);
  }, []);

  const pushRecentCall = useCallback(
    async (
      direction: CallRecord["direction"],
      dialNumber: string,
      status: string,
      name?: string,
    ) => {
      const record = await recordCall(callHistory, {
        account: accountKeyRef.current,
        number: dialNumber,
        direction,
        status,
        name,
      });

      if (!record) return;

      setRecentCalls((prev) => [record, ...prev].slice(0, 50));
    },
    [],
  );

  const callDisabled = useMemo(
    () =>
      registrationState !== "registered" ||
      callState === "dialing" ||
      callState === "early-media" ||
      callState === "active",
    [registrationState, callState],
  );

  const dtmfEnabled = useMemo(
    () => callState !== "idle" || incoming !== null,
    [callState, incoming],
  );

  useEffect(() => {
    writeMedia({
      audioInputDeviceId: settings.audioInputDeviceId,
      audioOutputDeviceId: settings.audioOutputDeviceId,
    });
  }, [settings.audioInputDeviceId, settings.audioOutputDeviceId]);

  useEffect(() => {
    const el = remoteAudioRef.current;

    if (!el || !settings.audioOutputDeviceId) return;

    const anyEl = el as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>;
    };

    if (typeof anyEl.setSinkId !== "function") return;

    anyEl.setSinkId(settings.audioOutputDeviceId).catch((error) => {
      appendLog(`setSinkId failed: ${String(error)}`);
    });
  }, [settings.audioOutputDeviceId, appendLog]);

  useEffect(() => {
    if (callState !== "ringing" || !incoming) {
      ringRef.current?.stop();
      ringRef.current = null;

      return;
    }

    const ring = new IncomingRingTone();

    ringRef.current = ring;
    void ring.start().catch(() => undefined);

    return () => {
      ring.stop();

      if (ringRef.current === ring) {
        ringRef.current = null;
      }
    };
  }, [callState, incoming]);

  const connect = useCallback(async () => {
    setLogs([]);

    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }

    const creds = {
      websocketUrl: settings.websocketUrl,
      domain: settings.domain,
      username: settings.username,
      password: settings.password,
      loginUserOnly: settings.loginUserOnly,
    };

    const client = new VertoClient(
      {
        ...creds,
        callerIdName: settings.username,
        audioInputDeviceId: settings.audioInputDeviceId || undefined,
      },
      {
        onRegistrationState: (state, reason) => {
          setRegistrationState(state);

          if (reason) appendLog(`register ${state}: ${reason}`);
          else appendLog(`register ${state}`);

          if (state === "registered") {
            void loadHistory(accountKeyRef.current);
          }
        },
        onCallState: (state, reason) => {
          setCallState(state);

          if (reason) appendLog(`call ${state}: ${reason}`);
          else appendLog(`call ${state}`);

          if (state === "idle") {
            setIncoming(null);
            setNumber("");
          }
        },
        onIncomingCall: (call) => {
          setIncoming(call);
          void pushRecentCall(
            "incoming",
            call.callerNumber,
            "ringing",
            call.callerName,
          );
          appendLog(`incoming ${call.callerNumber}`);
        },
        onRemoteStream: (stream) => {
          const el = remoteAudioRef.current;

          if (!el) return;

          el.srcObject = stream;
          void el.play().catch(() => {
            appendLog("remote stream ready, click page to allow autoplay");
          });
        },
        onLog: appendLog,
      },
    );

    clientRef.current = client;

    try {
      await registerSession(client, sessionStore, creds);
    } catch (error) {
      appendLog(`connect failed: ${String(error)}`);
    }
  }, [settings, appendLog, loadHistory, pushRecentCall]);

  useEffect(() => {
    if (persistedSessionAutoConnectStarted) return;
    if (!hasPersistedSession(settings)) return;

    persistedSessionAutoConnectStarted = true;
    void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional once on mount from persisted session
  }, []);

  const disconnect = useCallback(() => {
    disconnectSession(clientRef.current, sessionStore);
    clientRef.current = null;
    persistedSessionAutoConnectStarted = false;

    setSettings((prev) => ({
      ...defaultSettings,
      audioInputDeviceId: prev.audioInputDeviceId,
      audioOutputDeviceId: prev.audioOutputDeviceId,
    }));

    setRegistrationState("disconnected");
    setCallState("idle");
    setMuted(false);
    setIncoming(null);
    appendLog("disconnected by user");
  }, [appendLog]);

  const placeCallNow = useCallback(async () => {
    const dialNumber = number.trim();
    const client = clientRef.current;

    if (!dialNumber) {
      appendLog("call skipped: destination is empty");
      return;
    }

    if (!client) {
      appendLog("call skipped: no active client");
      return;
    }

    try {
      const record = await placeCallUseCase(client, callHistory, {
        account: accountKeyRef.current,
        number: dialNumber,
      });

      if (record) {
        setRecentCalls((prev) => [record, ...prev].slice(0, 50));
      }
    } catch (error) {
      appendLog(
        error instanceof Error && error.message === "destination is empty"
          ? "call skipped: destination is empty"
          : `call failed: ${String(error)}`,
      );
    }
  }, [number, appendLog]);

  const answerIncoming = useCallback(async () => {
    const client = clientRef.current;

    if (!client) return;

    try {
      if (incoming) {
        setNumber(incoming.callerNumber);
      }

      await answerCallUseCase(client);
      setIncoming(null);
    } catch (error) {
      appendLog(`answer failed: ${String(error)}`);
    }
  }, [incoming, appendLog]);

  const hangup = useCallback(() => {
    hangupCall(clientRef.current);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      clientRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const canSendDtmf = useCallback(() => clientRef.current?.canSendDtmf() ?? false, []);

  const sendDtmfDigit = useCallback((digit: string) => {
    return sendDtmf(clientRef.current, digit);
  }, []);

  const sendDtmfSeq = useCallback(async (sequence: string) => {
    const client = clientRef.current;

    if (!client) {
      throw new Error("no active client");
    }

    await sendDtmfSequence(client, sequence);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  return {
    settings,
    setSettings,
    registrationState,
    callState,
    number,
    setNumber,
    muted,
    incoming,
    recentCalls,
    logs,
    appendLog,
    clearLogs,
    remoteAudioRef,
    inCall,
    isRegistered,
    accountKey,
    callDisabled,
    dtmfEnabled,
    connect,
    disconnect,
    placeCallNow,
    answerIncoming,
    hangup,
    toggleMute,
    canSendDtmf,
    sendDtmfDigit,
    sendDtmfSeq,
  };
}
