import type { SoftphoneCredentials } from "@/domain/entities";
import type { SoftphonePort } from "@/domain/softphone.port";
import type { SessionStorePort } from "@/domain/session-store.port";

export async function registerSession(
  softphone: SoftphonePort,
  store: SessionStorePort,
  creds: SoftphoneCredentials,
): Promise<void> {
  store.write(creds);
  await softphone.connect();
}
