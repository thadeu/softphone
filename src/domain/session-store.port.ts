import type { SoftphoneCredentials } from "./entities";

export type SessionStorePort = {
  write(creds: SoftphoneCredentials): void;
  clear(): void;
};
