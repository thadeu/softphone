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

export type SoftphoneProtocol = "verto" | "sip";

export type IncomingCall = {
  callId: string;
  callerName: string;
  callerNumber: string;
  sdp: string;
};

export type SoftphoneCredentials = {
  protocol: SoftphoneProtocol;
  websocketUrl: string;
  domain: string;
  username: string;
  password: string;
  loginUserOnly: boolean;
  /**
   * Optional SIP User-Agent string (JsSIP `user_agent`).
   * Some SBCs (e.g. Atende Kamailio) require a specific value such as `AS-webrtc`.
   * Empty = library default.
   */
  sipUserAgent: string;
};

export type SoftphoneMediaSettings = {
  audioInputDeviceId: string;
  audioOutputDeviceId: string;
};

export type SoftphoneSettings = SoftphoneCredentials & SoftphoneMediaSettings;

export type CallRecord = {
  id: string;
  account: string;
  number: string;
  name: string;
  direction: "incoming" | "outgoing";
  at: string;
  status: string;
  createdAt: number;
};

export function normalizeProtocol(value: unknown): SoftphoneProtocol {
  return value === "sip" ? "sip" : "verto";
}
