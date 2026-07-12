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

export type SoftphoneCredentials = {
  websocketUrl: string;
  domain: string;
  username: string;
  password: string;
  loginUserOnly: boolean;
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
