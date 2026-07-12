import type {
  CallState,
  IncomingCall,
  RegistrationState,
  SoftphoneCredentials,
} from "./entities";

export type SoftphoneConfig = SoftphoneCredentials & {
  callerIdName?: string;
  audioInputDeviceId?: string;
};

export type SoftphoneEvents = {
  onRegistrationState: (state: RegistrationState, reason?: string) => void;
  onCallState: (state: CallState, reason?: string) => void;
  onIncomingCall: (call: IncomingCall) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onLog: (line: string) => void;
};

export type SoftphonePort = {
  connect(): Promise<void>;
  disconnect(): void;
  call(destination: string): Promise<void>;
  answer(): Promise<void>;
  hangup(): void;
  setMuted(muted: boolean): void;
  sendDtmf(digit: string): boolean;
  sendDtmfSequence(sequence: string, gapMs?: number): Promise<void>;
  canSendDtmf(): boolean;
};
