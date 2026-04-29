import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import {
  ArrowLeft,
  Clock,
  Delete,
  Grid3X3,
  LogOut,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
  ScrollText,
  Search,
  Volume2,
  X,
} from "lucide-react";
import { randomId } from "./lib/randomId";
import { VertoClient } from "./lib/vertoClient";
import type {
  CallState,
  IncomingCall,
  RegistrationState,
} from "./lib/vertoClient";
import { IncomingRingTone } from "./lib/ringTone";
import { db } from "./lib/db";
import type { CallRecord } from "./lib/db";

type SettingsData = {
  websocketUrl: string;
  domain: string;
  username: string;
  password: string;
  loginUserOnly: boolean;
  audioInputDeviceId: string;
  audioOutputDeviceId: string;
};

const LEGACY_SETTINGS_KEY = "softphone.verto.settings";
const SESSION_STORAGE_KEY = "softphone.verto.session";
const MEDIA_STORAGE_KEY = "softphone.verto.media";

type SessionCredentials = Pick<
  SettingsData,
  "websocketUrl" | "domain" | "username" | "password" | "loginUserOnly"
>;

const defaultSettings: SettingsData = {
  websocketUrl: "",
  domain: "default",
  username: "",
  password: "",
  loginUserOnly: false,
  audioInputDeviceId: "",
  audioOutputDeviceId: "",
};

function readSession(): Partial<SessionCredentials> | null {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);

  if (!raw) return null;

  try {
    return JSON.parse(raw) as Partial<SessionCredentials>;
  } catch {
    return null;
  }
}

function writeSession(creds: SessionCredentials): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(creds));
}

function clearSessionStorage(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

function readMedia(): Pick<SettingsData, "audioInputDeviceId" | "audioOutputDeviceId"> {
  const raw = localStorage.getItem(MEDIA_STORAGE_KEY);

  if (!raw) {
    return { audioInputDeviceId: "", audioOutputDeviceId: "" };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SettingsData>;

    return {
      audioInputDeviceId: typeof parsed.audioInputDeviceId === "string" ? parsed.audioInputDeviceId : "",
      audioOutputDeviceId:
        typeof parsed.audioOutputDeviceId === "string" ? parsed.audioOutputDeviceId : "",
    };
  } catch {
    return { audioInputDeviceId: "", audioOutputDeviceId: "" };
  }
}

function writeMedia(media: Pick<SettingsData, "audioInputDeviceId" | "audioOutputDeviceId">): void {
  localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(media));
}

function migrateLegacySettingsIfNeeded(): void {
  if (localStorage.getItem(SESSION_STORAGE_KEY)) return;

  const raw = localStorage.getItem(LEGACY_SETTINGS_KEY);

  if (!raw) return;

  try {
    const parsed = { ...defaultSettings, ...(JSON.parse(raw) as Partial<SettingsData>) };
    const ws = parsed.websocketUrl.trim();
    const user = parsed.username.trim();
    const pass = parsed.password;

    if (ws && user && pass.trim()) {
      writeSession({
        websocketUrl: parsed.websocketUrl,
        domain: parsed.domain,
        username: parsed.username,
        password: parsed.password,
        loginUserOnly: parsed.loginUserOnly,
      });
    }

    writeMedia({
      audioInputDeviceId: parsed.audioInputDeviceId,
      audioOutputDeviceId: parsed.audioOutputDeviceId,
    });
  } catch {
    // ignore invalid legacy payload
  }

  localStorage.removeItem(LEGACY_SETTINGS_KEY);
}

const AVATAR_COLORS = [
  "#34c759", "#2d5bf0", "#ff9500", "#af52de",
  "#ff3b30", "#5856d6", "#007aff", "#ff2d55",
  "#30b0c7", "#a2845e",
];

function loadSettings(): SettingsData {
  migrateLegacySettingsIfNeeded();

  const session = readSession();
  const media = readMedia();

  return {
    ...defaultSettings,
    ...(session ?? {}),
    ...media,
  };
}

function hasPersistedSession(s: SettingsData): boolean {
  const ws = s.websocketUrl.trim();
  const user = s.username.trim();
  const pass = s.password.trim();
  const domainOk = s.loginUserOnly || s.domain.trim().length > 0;

  return Boolean(ws && user && pass && domainOk);
}

let persistedSessionAutoConnectStarted = false;

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);

  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  return name.slice(0, 2).toUpperCase();
}

function hashColor(str: string): string {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function App() {
  const [settings, setSettings] = useState<SettingsData>(loadSettings);
  const [registrationState, setRegistrationState] =
    useState<RegistrationState>("disconnected");
  const [callState, setCallState] = useState<CallState>("idle");
  const [number, setNumber] = useState("");
  const [muted, setMuted] = useState(false);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [recentCalls, setRecentCalls] = useState<CallRecord[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [callElapsed, setCallElapsed] = useState(0);
  const [showDtmfPad, setShowDtmfPad] = useState(false);
  const [dtmfDigits, setDtmfDigits] = useState("");
  const [transferFlow, setTransferFlow] = useState<"idle" | "pick-type" | "dial-extension">("idle");
  const [transferKind, setTransferKind] = useState<"consult" | "blind" | "return" | null>(null);
  const [transferBuffer, setTransferBuffer] = useState("");
  const [historyFilter, setHistoryFilter] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"history" | "logs">("history");
  const [mobilePanel, setMobilePanel] = useState<"history" | "logs" | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const clientRef = useRef<VertoClient | null>(null);
  const ringRef = useRef<IncomingRingTone | null>(null);
  const inCall = callState === "dialing" || callState === "early-media" || callState === "active";
  const isRegistered = registrationState === "registered";

  const accountKey = useMemo(
    () => settings.loginUserOnly
      ? settings.username.trim()
      : `${settings.username.trim()}@${settings.domain.trim()}`,
    [settings.username, settings.domain, settings.loginUserOnly],
  );

  const filteredCalls = useMemo(() => {
    if (!historyFilter.trim()) return recentCalls;

    const q = historyFilter.toLowerCase();

    return recentCalls.filter(
      (c) => c.name.toLowerCase().includes(q) || c.number.includes(q),
    );
  }, [recentCalls, historyFilter]);

  const loadHistory = async (account: string) => {
    const rows = await db.calls
      .where("account")
      .equals(account)
      .reverse()
      .sortBy("createdAt");

    setRecentCalls(rows.slice(0, 50));
  };

  const appendLog = (line: string) => {
    setLogs((prev) => [...prev, new Date().toLocaleTimeString() + " " + line].slice(-200));
  };

  const pushRecentCall = (
    direction: CallRecord["direction"],
    dialNumber: string,
    status: string,
    name?: string,
  ) => {
    const clean = dialNumber.trim();

    if (!clean) {
      return;
    }

    const record: CallRecord = {
      id: randomId(),
      account: accountKey,
      number: clean,
      name: name?.trim() || clean,
      direction,
      at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      status,
      createdAt: Date.now(),
    };

    db.calls.add(record);

    setRecentCalls((prev) => [record, ...prev].slice(0, 50));
  };

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
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }

    if (callState === "active") {
      setCallElapsed(0);

      callTimerRef.current = setInterval(() => {
        setCallElapsed((prev) => prev + 1);
      }, 1000);
    } else if (callState === "idle") {
      setCallElapsed(0);
      setShowDtmfPad(false);
      setDtmfDigits("");
    }

    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
    };
  }, [callState]);

  useEffect(() => {
    if (sidebarTab === "logs") {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, sidebarTab]);

  const formatCallTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");

    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  useEffect(() => {
    if (!inCall) {
      setShowDtmfPad(false);
      setDtmfDigits("");
      setTransferFlow("idle");
      setTransferKind(null);
      setTransferBuffer("");
    }
  }, [inCall]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!dtmfEnabled || !clientRef.current?.canSendDtmf()) {
        return;
      }

      const target = e.target as HTMLElement | null;

      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (transferFlow === "dial-extension") {
        const key = e.key;

        if (key === "Backspace") {
          e.preventDefault();
          setTransferBuffer((prev) => prev.slice(0, -1));

          return;
        }

        if (/^[\d]$/.test(key)) {
          e.preventDefault();
          setTransferBuffer((prev) => prev + key);
        }

        return;
      }

      if (transferFlow === "pick-type") {
        return;
      }

      const key = e.key;

      if (!/^[\d*#]$/.test(key)) {
        return;
      }

      e.preventDefault();
      clientRef.current.sendDtmf(key);

      if (showDtmfPad) {
        setDtmfDigits((prev) => prev + key);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dtmfEnabled, inCall, showDtmfPad, transferFlow]);

  useEffect(() => {
    const refreshDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();

        setAudioInputs(devices.filter((d) => d.kind === "audioinput"));
        setAudioOutputs(devices.filter((d) => d.kind === "audiooutput"));
      } catch {
        return;
      }
    };

    void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);

    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
    };
  }, []);

  useEffect(() => {
    writeMedia({
      audioInputDeviceId: settings.audioInputDeviceId,
      audioOutputDeviceId: settings.audioOutputDeviceId,
    });
  }, [settings.audioInputDeviceId, settings.audioOutputDeviceId]);

  useEffect(() => {
    if (persistedSessionAutoConnectStarted) return;

    if (!hasPersistedSession(settings)) return;

    persistedSessionAutoConnectStarted = true;
    void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional once on mount from persisted session
  }, []);

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
  }, [settings.audioOutputDeviceId]);

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

  const connect = async () => {
    setLogs([]);

    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }

    writeSession({
      websocketUrl: settings.websocketUrl,
      domain: settings.domain,
      username: settings.username,
      password: settings.password,
      loginUserOnly: settings.loginUserOnly,
    });

    const client = new VertoClient(
      {
        websocketUrl: settings.websocketUrl,
        domain: settings.domain,
        username: settings.username,
        password: settings.password,
        callerIdName: settings.username,
        loginUserOnly: settings.loginUserOnly,
        audioInputDeviceId: settings.audioInputDeviceId || undefined,
      },
      {
        onRegistrationState: (state, reason) => {
          setRegistrationState(state);

          if (reason) appendLog(`register ${state}: ${reason}`);
          else appendLog(`register ${state}`);

          if (state === "registered") {
            loadHistory(accountKey);
          }
        },
        onCallState: (state, reason) => {
          setCallState(state);

          if (reason) appendLog(`call ${state}: ${reason}`);
          else appendLog(`call ${state}`);

          if (state === "idle") {
            setIncoming(null);
            setNumber('')
          }
        },
        onIncomingCall: (call) => {
          setIncoming(call);
          pushRecentCall("incoming", call.callerNumber, "ringing", call.callerName);
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
      await client.connect();
    } catch (error) {
      appendLog(`connect failed: ${String(error)}`);
    }
  };

  const disconnect = () => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }

    clearSessionStorage();
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
  };

  const placeCallNow = async () => {
    const dialNumber = number.trim();

    if (!dialNumber) {
      appendLog("call skipped: destination is empty");

      return;
    }

    pushRecentCall("outgoing", dialNumber, "dialing");

    try {
      await clientRef.current?.call(dialNumber);
    } catch (error) {
      appendLog(`call failed: ${String(error)}`);
    }
  };

  const placeCall = async (event: FormEvent) => {
    event.preventDefault();
    await placeCallNow();
  };

  const answerCall = async () => {
    try {
      if (incoming) {
        setNumber(incoming.callerNumber);
      }

      await clientRef.current?.answer();
      setIncoming(null);
    } catch (error) {
      appendLog(`answer failed: ${String(error)}`);
    }
  };

  const hangup = () => clientRef.current?.hangup();

  const toggleMute = () => {
    const next = !muted;

    setMuted(next);
    clientRef.current?.setMuted(next);
  };

  const sendPadDtmf = (digit: string) => {
    clientRef.current?.sendDtmf(digit);
    setDtmfDigits((prev) => prev + digit);
  };

  const TRANSFER_SHORTCODE = {
    consult: "*95",
    blind: "*96",
    return: "*98",
  } as const;

  type TransferKind = keyof typeof TRANSFER_SHORTCODE;

  const TRANSFER_META: Record<
    TransferKind,
    { title: string; subtitle: string }
  > = {
    consult: { title: "Consult transfer", subtitle: "Shortcode *95 — enter extension" },
    blind: { title: "Blind transfer", subtitle: "Shortcode *96 — enter extension" },
    return: { title: "Return transfer", subtitle: "Shortcode *98 — enter extension" },
  };

  const closeTransferFlow = () => {
    setTransferFlow("idle");
    setTransferKind(null);
    setTransferBuffer("");
  };

  const appendTransferDigit = (digit: string) => {
    if (!/^\d$/.test(digit)) return;

    setTransferBuffer((prev) => prev + digit);
  };

  const sendTransferFromBuffer = async () => {
    if (!transferKind) return;

    const extension = transferBuffer.replace(/\D/g, "");

    if (!extension) {
      appendLog("transfer: enter extension digits on the keypad");

      return;
    }

    const prefix = TRANSFER_SHORTCODE[transferKind];
    const sequence = `${prefix}${extension}#`;

    appendLog(`transfer ${transferKind}: ${sequence}`);

    const client = clientRef.current;

    if (!client) {
      appendLog("transfer: no active client");

      return;
    }

    try {
      await client.sendDtmfSequence(sequence);
      closeTransferFlow();
    } catch (error) {
      appendLog(`transfer sequence failed: ${String(error)}`);
    }
  };

  const appendDialDigit = (digit: string) => {
    if (dtmfEnabled && clientRef.current?.canSendDtmf()) {
      clientRef.current.sendDtmf(digit);

      return;
    }

    setNumber((prev) => prev + digit);
  };

  const domainFromWebSocketHost = (): string => {
    try {
      const u = new URL(settings.websocketUrl.replace(/^ws/i, "http"));

      return u.hostname || settings.domain;
    } catch {
      return settings.domain;
    }
  };

  const dialPadKeys = [
    ["1", ""],
    ["2", "ABC"],
    ["3", "DEF"],
    ["4", "GHI"],
    ["5", "JKL"],
    ["6", "MNO"],
    ["7", "PQRS"],
    ["8", "TUV"],
    ["9", "WXYZ"],
    ["*", ""],
    ["0", "+"],
    ["#", ""],
  ];

  if (!isRegistered) {
    return (
      <main className="softphone-shell">
        <div className="setup-page">
          <div className="setup-card">
            <div className="setup-header">
              <Phone size={20} />
              <h1>SIP Configuration</h1>
            </div>

            <div className="setup-status-banner">
              <div className={`setup-status-icon${registrationState === "connecting" ? " connecting" : " offline"}`}>
                <Phone size={18} />
              </div>
              <div className="setup-status-text">
                <strong>
                  {registrationState === "connecting" ? "Connecting..." : "Disconnected"}
                </strong>
                <span>Configure your Verto settings below</span>
              </div>
            </div>

            <form
              id="register-form"
              className="setup-form"
              onSubmit={(e) => {
                e.preventDefault();
                void connect();
              }}
            >
              <label>
                WebSocket URL
                <input
                  value={settings.websocketUrl}
                  onChange={(e) => setSettings((s) => ({ ...s, websocketUrl: e.target.value }))}
                  placeholder="wss://sip.example.com:8089/ws"
                />
              </label>
              <label>
                Domain
                <input
                  value={settings.domain}
                  onChange={(e) => setSettings((s) => ({ ...s, domain: e.target.value }))}
                  placeholder="default"
                />
                <span className="domain-actions">
                  <button
                    type="button"
                    className="btn-inline"
                    onClick={() => setSettings((s) => ({ ...s, domain: "default" }))}
                  >
                    default
                  </button>
                  <button
                    type="button"
                    className="btn-inline"
                    onClick={() =>
                      setSettings((s) => ({ ...s, domain: domainFromWebSocketHost() }))
                    }
                  >
                    from WSS
                  </button>
                </span>
              </label>
              <label>
                Username / Extension
                <input
                  value={settings.username}
                  onChange={(e) => setSettings((s) => ({ ...s, username: e.target.value }))}
                  placeholder="user@domain.com or extension number"
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={settings.password}
                  onChange={(e) => setSettings((s) => ({ ...s, password: e.target.value }))}
                  placeholder="••••••••"
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.loginUserOnly}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, loginUserOnly: e.target.checked }))
                  }
                />
                Login as username only (no @domain)
              </label>
            </form>

            {registrationState === "failed" && (
              <div className="setup-hint">
                <strong>Note:</strong> You need a SIP server with WebSocket support (like FreeSWITCH, Asterisk, or Kamailio). If you get <code>-32001</code>, check the domain and password in your directory config.
              </div>
            )}

            <button
              type="submit"
              className="btn-primary setup-submit"
              form="register-form"
            >
              Save Configuration
            </button>

            {logs.length > 0 && (
              <div className="setup-logs">
                <div className="setup-logs-header">
                  <span>Connection logs</span>
                  <button type="button" className="btn-inline" onClick={() => setLogs([])}>
                    Clear
                  </button>
                </div>
                <pre className="logs-pre">{logs.join("\n")}</pre>
              </div>
            )}
          </div>
        </div>
        <audio ref={remoteAudioRef} autoPlay playsInline />
      </main>
    );
  }

  return (
    <main className="softphone-shell">
      <div className="softphone-window">
        <header className="window-topbar">
          <div className="brand">
            <span className="brand-dot" />
            <p className="window-title">Phone</p>
          </div>
          <div className="topbar-right">
            <span className="topbar-user">{settings.username}</span>
            <span className="pill registered">connected</span>
            {callState !== "idle" && (
              <span className={`pill ${callState}${callState === "ringing" ? " ringing-pulse" : ""}`}>
                {callState}
              </span>
            )}
            <button
              type="button"
              className="topbar-icon-btn mobile-only"
              onClick={() => setMobilePanel(mobilePanel === "history" ? null : "history")}
              title="History"
            >
              <Clock size={14} />
            </button>
            <button
              type="button"
              className="topbar-icon-btn mobile-only"
              onClick={() => setMobilePanel(mobilePanel === "logs" ? null : "logs")}
              title="Logs"
            >
              <ScrollText size={14} />
            </button>
            <button
              type="button"
              className="topbar-icon-btn logout"
              onClick={disconnect}
              title="Disconnect"
            >
              <LogOut size={14} />
            </button>
          </div>
        </header>

        {mobilePanel && (
          <div className="mobile-popover-backdrop" onClick={() => setMobilePanel(null)}>
            <div className="mobile-popover" onClick={(e) => e.stopPropagation()}>
              <div className="mobile-popover-header">
                <h3>{mobilePanel === "history" ? "History" : "Logs"}</h3>
                <button type="button" className="mobile-popover-close" onClick={() => setMobilePanel(null)}>
                  <X size={18} />
                </button>
              </div>
              {mobilePanel === "history" && (
                <>
                  <div className="sidebar-search" style={{ margin: "0 0 4px" }}>
                    <Search size={14} className="sidebar-search-icon" />
                    <input
                      className="sidebar-search-input"
                      value={historyFilter}
                      onChange={(e) => setHistoryFilter(e.target.value)}
                      placeholder="Search"
                    />
                  </div>
                  <div className="mobile-popover-list">
                    {filteredCalls.length === 0 && recentCalls.length === 0 && (
                      <p className="empty-state">No call history yet</p>
                    )}
                    {filteredCalls.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className="recent-item"
                        onClick={() => { setNumber(entry.number); setMobilePanel(null); }}
                      >
                        <span className="recent-icon-dir"><Phone size={11} /></span>
                        <span className="recent-avatar" style={{ background: hashColor(entry.name) }}>
                          {getInitials(entry.name)}
                        </span>
                        <span className="recent-body">
                          <span className="recent-main">{entry.name}</span>
                          <span className="recent-sub">{entry.number}</span>
                        </span>
                        <span className="recent-meta">{entry.at}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {mobilePanel === "logs" && (
                <div className="mobile-popover-list">
                  {logs.length === 0 ? (
                    <p className="empty-state">No logs yet</p>
                  ) : (
                    <pre className="logs-pre" style={{ fontSize: "10.5px" }}>{logs.join("\n")}</pre>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="window-body">
          <aside className="sidebar">
            <div className="sidebar-tabs">
              <button
                type="button"
                className={`sidebar-tab${sidebarTab === "history" ? " active" : ""}`}
                onClick={() => setSidebarTab("history")}
              >
                History
              </button>
              <button
                type="button"
                className={`sidebar-tab${sidebarTab === "logs" ? " active" : ""}`}
                onClick={() => setSidebarTab("logs")}
              >
                Logs
                {logs.length > 0 && <span className="sidebar-badge">{logs.length}</span>}
              </button>
            </div>

            {sidebarTab === "history" && (
              <>
                <div className="sidebar-search">
                  <Search size={14} className="sidebar-search-icon" />
                  <input
                    className="sidebar-search-input"
                    value={historyFilter}
                    onChange={(e) => setHistoryFilter(e.target.value)}
                    placeholder="Search"
                  />
                </div>
                <div className="sidebar-list">
                  {filteredCalls.length === 0 && recentCalls.length === 0 && (
                    <p className="empty-state">No call history yet</p>
                  )}
                  {filteredCalls.length === 0 && recentCalls.length > 0 && (
                    <p className="empty-state">No results</p>
                  )}
                  {filteredCalls.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="recent-item"
                      onClick={() => setNumber(entry.number)}
                    >
                      <span className="recent-icon-dir">
                        <Phone size={11} />
                      </span>
                      <span
                        className="recent-avatar"
                        style={{ background: hashColor(entry.name) }}
                      >
                        {getInitials(entry.name)}
                      </span>
                      <span className="recent-body">
                        <span className="recent-main">{entry.name}</span>
                        <span className="recent-sub">{entry.number}</span>
                      </span>
                      <span className="recent-meta">{entry.at}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {sidebarTab === "logs" && (
              <div className="sidebar-logs">
                <div className="sidebar-logs-header">
                  {logs.length > 0 && (
                    <button type="button" className="btn-inline" onClick={() => setLogs([])}>
                      Clear
                    </button>
                  )}
                </div>
                {logs.length === 0 ? (
                  <p className="empty-state">No logs yet</p>
                ) : (
                  <pre className="logs-pre sidebar-logs-pre">
                    {logs.join("\n")}
                    <div ref={logsEndRef} />
                  </pre>
                )}
              </div>
            )}

            <footer className="sidebar-footer">
              <label className="footer-device">
                <Mic size={13} />
                <select
                  className="footer-device-select"
                  value={settings.audioInputDeviceId}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, audioInputDeviceId: e.target.value }))
                  }
                >
                  <option value="">Default mic</option>
                  {audioInputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Mic ${d.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
              </label>
              <span className="footer-sep" />
              <label className="footer-device">
                <Volume2 size={13} />
                <select
                  className="footer-device-select"
                  value={settings.audioOutputDeviceId}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, audioOutputDeviceId: e.target.value }))
                  }
                >
                  <option value="">Default speaker</option>
                  {audioOutputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Speaker ${d.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
              </label>
            </footer>
          </aside>

          <section className="main-content">
            {inCall ? (
              <div className="call-panel">
                <div className="call-info">
                  <h2 className="call-number">
                    {number || incoming?.callerNumber || "Call"}
                    <span className="call-chevron"> ›</span>
                  </h2>
                  <p className="call-timer">
                    {callState === "active"
                      ? formatCallTime(callElapsed)
                      : callState === "dialing"
                        ? "Calling..."
                        : "Connecting..."}
                  </p>
                </div>

                {transferFlow === "pick-type" ? (
                  <div className="call-transfer-flow">
                    <h3 className="call-transfer-flow-title">Transfer</h3>
                    <p className="call-transfer-flow-sub">Choose transfer type</p>
                    <div className="call-transfer-type-grid">
                      {(["consult", "blind", "return"] as const).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          className="action-btn"
                          disabled={!dtmfEnabled}
                          onClick={() => {
                            setTransferKind(kind);
                            setTransferBuffer("");
                            setTransferFlow("dial-extension");
                          }}
                        >
                          <span className="action-icon">
                            <PhoneForwarded size={20} />
                          </span>
                          <span>
                            {kind === "consult" ? "Consult (*95)" : kind === "blind" ? "Blind (*96)" : "Return (*98)"}
                          </span>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn-inline call-transfer-flow-cancel"
                      onClick={closeTransferFlow}
                    >
                      Cancel
                    </button>
                  </div>
                ) : transferFlow === "dial-extension" && transferKind ? (
                  <div className="call-transfer-dial">
                    <button
                      type="button"
                      className="btn-inline call-transfer-back"
                      onClick={() => {
                        setTransferFlow("pick-type");
                        setTransferKind(null);
                        setTransferBuffer("");
                      }}
                    >
                      <ArrowLeft size={16} strokeWidth={2} />
                      Back
                    </button>
                    <h3 className="call-transfer-dial-title">{TRANSFER_META[transferKind].title}</h3>
                    <p className="call-transfer-dial-sub">{TRANSFER_META[transferKind].subtitle}</p>
                    <div className="dtmf-digits-display" title="Extension (not sent until Send)">
                      {transferBuffer || "—"}
                    </div>
                    <div className="call-dtmf-grid">
                      {dialPadKeys.map(([digit, letters]) => (
                        <button
                          key={digit}
                          type="button"
                          className="dial-key dtmf-key"
                          disabled={!dtmfEnabled || !/^\d$/.test(digit)}
                          onClick={() => appendTransferDigit(digit)}
                        >
                          <span>{digit}</span>
                          <small>{letters}</small>
                        </button>
                      ))}
                    </div>
                    <div className="call-transfer-dial-actions">
                      <button
                        type="button"
                        className="btn-transfer-delete"
                        disabled={!transferBuffer}
                        onClick={() => setTransferBuffer((prev) => prev.slice(0, -1))}
                        aria-label="Delete last digit"
                      >
                        <Delete size={18} />
                      </button>
                      <button
                        type="button"
                        className="btn-transfer-send"
                        disabled={!dtmfEnabled}
                        onClick={() => void sendTransferFromBuffer()}
                      >
                        Send
                      </button>
                    </div>
                    <button type="button" className="btn-inline dtmf-close" onClick={closeTransferFlow}>
                      Close
                    </button>
                  </div>
                ) : showDtmfPad ? (
                  <div className="call-dtmf-section">
                    <p className="call-dtmf-hint">Live DTMF to the active call (IVR / menu).</p>
                    <div className="dtmf-digits-display" title="DTMF sent this session">
                      {dtmfDigits || "—"}
                    </div>
                    <div className="call-dtmf-grid">
                      {dialPadKeys.map(([digit, letters]) => (
                        <button
                          key={digit}
                          type="button"
                          className="dial-key dtmf-key"
                          disabled={!dtmfEnabled}
                          onClick={() => sendPadDtmf(digit)}
                        >
                          <span>{digit}</span>
                          <small>{letters}</small>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn-inline dtmf-close"
                      onClick={() => {
                        setShowDtmfPad(false);
                        setDtmfDigits("");
                      }}
                    >
                      Close keypad
                    </button>
                  </div>
                ) : (
                  <div className="call-actions-grid call-actions-grid-in-call">
                    <button
                      type="button"
                      className={`action-btn${muted ? " action-active" : ""}`}
                      onClick={toggleMute}
                    >
                      <span className="action-icon">
                        {muted ? <MicOff size={20} /> : <Mic size={20} />}
                      </span>
                      <span>Mute</span>
                    </button>
                    <button
                      type="button"
                      className="action-btn"
                      onClick={() => {
                        closeTransferFlow();
                        setDtmfDigits("");
                        setShowDtmfPad(true);
                      }}
                    >
                      <span className="action-icon">
                        <Grid3X3 size={20} />
                      </span>
                      <span>Keypad</span>
                    </button>
                    <button type="button" className="action-btn" disabled>
                      <span className="action-icon">
                        <Volume2 size={20} />
                      </span>
                      <span>Audio</span>
                    </button>
                    <div className="call-actions-grid-full-row">
                      <button type="button" className="action-btn" disabled>
                        <span className="action-icon">
                          <Pause size={20} />
                        </span>
                        <span>Hold</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="call-bottom">
                  <div className="call-bottom-actions">
                    <button type="button" className="btn-hangup" onClick={hangup} aria-label="Hang up">
                      <PhoneOff size={22} />
                    </button>
                    <button
                      type="button"
                      className="btn-transfer-call"
                      onClick={() => {
                        setShowDtmfPad(false);
                        setDtmfDigits("");
                        setTransferKind(null);
                        setTransferBuffer("");
                        setTransferFlow("pick-type");
                      }}
                      aria-label="Transfer"
                      title="Transfer"
                    >
                      <PhoneForwarded size={22} />
                    </button>
                  </div>
                  <p className="call-caller-id">Caller ID: {settings.username}</p>
                </div>
              </div>
            ) : (
              <div className="dialer-area">
                <form className="dial-input-wrap" onSubmit={placeCall}>
                  <input
                    className="dial-display-input"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    placeholder="Enter number"
                  />
                </form>

                <div className="dial-grid">
                  {dialPadKeys.map(([digit, letters]) => (
                    <button
                      key={digit}
                      type="button"
                      className="dial-key home-key"
                      onClick={() => appendDialDigit(digit)}
                    >
                      <span>{digit}</span>
                      <small>{letters}</small>
                    </button>
                  ))}
                </div>

                <div className="dial-actions">
                  <span className="dial-actions-side">
                    {number && (
                      <button
                        type="button"
                        className="btn-dial-side"
                        onClick={() => setNumber((prev) => prev.slice(0, -1))}
                        aria-label="Delete last digit"
                      >
                        <Delete size={18} />
                      </button>
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn-call-home"
                    onClick={() => {
                      placeCallNow()
                    }}
                    disabled={callDisabled}
                    aria-label="Place call"
                  >
                    <PhoneCall size={24} />
                  </button>
                  <span className="dial-actions-side">
                    {number && (
                      <button
                        type="button"
                        className="btn-dial-side"
                        onClick={() => setNumber("")}
                        aria-label="Clear number"
                      >
                        <X size={18} />
                      </button>
                    )}
                  </span>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {incoming && (
        <div className="incoming-screen" role="alertdialog" aria-live="assertive">
          <div className="incoming-phone">
            <div
              className="incoming-avatar"
              style={{ background: hashColor(incoming.callerName || incoming.callerNumber) }}
            >
              {getInitials(incoming.callerName || incoming.callerNumber)}
            </div>
            <div className="incoming-info">
              <p className="incoming-label">Incoming call</p>
              <h2 className="incoming-name">{incoming.callerName || "Unknown"}</h2>
              <p className="incoming-number">{incoming.callerNumber}</p>
            </div>
            <div className="incoming-buttons">
              <button type="button" className="incoming-btn decline" onClick={hangup}>
                <PhoneOff size={24} />
                <span>Decline</span>
              </button>
              <button type="button" className="incoming-btn answer" onClick={answerCall}>
                <Phone size={24} />
                <span>Answer</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <audio ref={remoteAudioRef} autoPlay playsInline />
    </main>
  );
}

export default App;
