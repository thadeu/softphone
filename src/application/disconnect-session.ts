import type { SoftphonePort } from "@/domain/softphone.port";
import type { SessionStorePort } from "@/domain/session-store.port";

export function disconnectSession(
  softphone: SoftphonePort | null,
  store: SessionStorePort,
): void {
  softphone?.disconnect();
  store.clear();
}
