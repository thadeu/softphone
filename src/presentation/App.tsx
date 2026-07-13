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
import { useSoftphone } from "./hooks/useSoftphone";

const AVATAR_COLORS = [
  "#34c759", "#2d5bf0", "#ff9500", "#af52de",
  "#ff3b30", "#5856d6", "#007aff", "#ff2d55",
  "#30b0c7", "#a2845e",
];

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

const TRANSFER_SHORTCODE = {
  consult: "*95",
  blind: "*96",
  return: "*98",
} as const;

type TransferKind = keyof typeof TRANSFER_SHORTCODE;

const TRANSFER_META: Record<TransferKind, { title: string; subtitle: string }> = {
  consult: { title: "Consult transfer", subtitle: "Shortcode *95 — enter extension" },
  blind: { title: "Blind transfer", subtitle: "Shortcode *96 — enter extension" },
  return: { title: "Return transfer", subtitle: "Shortcode *98 — enter extension" },
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

function App() {
  const {
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
    callDisabled,
    dtmfEnabled,
    connect,
    disconnect,
    placeCallNow,
    answerIncoming,
    hangup,
    rejectIncoming,
    toggleMute,
    canSendDtmf,
    sendDtmfDigit,
    sendDtmfSeq,
  } = useSoftphone();

  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [callElapsed, setCallElapsed] = useState(0);
  const [showDtmfPad, setShowDtmfPad] = useState(false);
  const [dtmfDigits, setDtmfDigits] = useState("");
  const [transferFlow, setTransferFlow] = useState<"idle" | "pick-type" | "dial-extension">("idle");
  const [transferKind, setTransferKind] = useState<TransferKind | null>(null);
  const [transferBuffer, setTransferBuffer] = useState("");
  const [historyFilter, setHistoryFilter] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"history" | "logs">("history");
  const [mobilePanel, setMobilePanel] = useState<"history" | "logs" | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const filteredCalls = useMemo(() => {
    if (!historyFilter.trim()) return recentCalls;

    const q = historyFilter.toLowerCase();

    return recentCalls.filter(
      (c) => c.name.toLowerCase().includes(q) || c.number.includes(q),
    );
  }, [recentCalls, historyFilter]);

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
      if (!dtmfEnabled || !canSendDtmf()) {
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
      sendDtmfDigit(key);

      if (showDtmfPad) {
        setDtmfDigits((prev) => prev + key);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dtmfEnabled, inCall, showDtmfPad, transferFlow, canSendDtmf, sendDtmfDigit]);

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

  const placeCall = async (event: FormEvent) => {
    event.preventDefault();
    await placeCallNow();
  };

  const answerCall = async () => {
    await answerIncoming();
  };

  const sendPadDtmf = (digit: string) => {
    sendDtmfDigit(digit);
    setDtmfDigits((prev) => prev + digit);
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

    try {
      await sendDtmfSeq(sequence);
      closeTransferFlow();
    } catch (error) {
      appendLog(`transfer sequence failed: ${String(error)}`);
    }
  };

  const appendDialDigit = (digit: string) => {
    if (dtmfEnabled && canSendDtmf()) {
      sendDtmfDigit(digit);

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

  if (!isRegistered) {
    return (
      <main className="softphone-shell">
        <div className="setup-page">
          <div className="setup-card">
            <div className="setup-header">
              <Phone size={20} />
              <h1>Softphone Configuration</h1>
            </div>

            <div className="setup-status-banner">
              <div className={`setup-status-icon${registrationState === "connecting" ? " connecting" : " offline"}`}>
                <Phone size={18} />
              </div>
              <div className="setup-status-text">
                <strong>
                  {registrationState === "connecting" ? "Connecting..." : "Disconnected"}
                </strong>
                <span>
                  {settings.protocol === "sip"
                    ? "Configure Kamailio SIP (WS/WSS) below"
                    : "Configure FreeSWITCH Verto below"}
                </span>
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
                Server
                <select
                  value={settings.protocol === "sip" ? "sip" : "verto"}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      protocol: e.target.value === "sip" ? "sip" : "verto",
                    }))
                  }
                >
                  <option value="verto">FreeSWITCH</option>
                  <option value="sip">Kamailio</option>
                </select>
              </label>
              <label>
                WebSocket URL
                <input
                  value={settings.websocketUrl}
                  onChange={(e) => setSettings((s) => ({ ...s, websocketUrl: e.target.value }))}
                  placeholder={
                    settings.protocol === "sip"
                      ? "ws://kamailio.example:8080"
                      : "wss://fs.example.com:8082"
                  }
                />
              </label>
              <label>
                Domain
                <input
                  value={settings.domain}
                  onChange={(e) => setSettings((s) => ({ ...s, domain: e.target.value }))}
                  placeholder={settings.protocol === "sip" ? "sip.example.com" : "default"}
                />
                <span className="domain-actions">
                  {settings.protocol !== "sip" && (
                    <button
                      type="button"
                      className="btn-inline"
                      onClick={() => setSettings((s) => ({ ...s, domain: "default" }))}
                    >
                      default
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-inline"
                    onClick={() =>
                      setSettings((s) => ({ ...s, domain: domainFromWebSocketHost() }))
                    }
                  >
                    from WS
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
              {settings.protocol !== "sip" && (
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
              )}
            </form>

            {registrationState === "failed" && (
              <div className="setup-hint">
                {settings.protocol === "sip" ? (
                  <>
                    <strong>Note:</strong> Requires Kamailio with WebSocket + digest auth
                    (dynamic REGISTER). Use <code>ws://</code> or <code>wss://</code> in the
                    WebSocket URL. Check username, domain and password.
                  </>
                ) : (
                  <>
                    <strong>Note:</strong> Requires FreeSWITCH with <code>mod_verto</code>. If
                    you get <code>-32001</code>, check domain and password in the directory.
                  </>
                )}
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
                  <button type="button" className="btn-inline" onClick={clearLogs}>
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
                    <button type="button" className="btn-inline" onClick={clearLogs}>
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
              <button type="button" className="incoming-btn decline" onClick={rejectIncoming}>
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
