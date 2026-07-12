import type { SoftphonePort } from "@/domain/softphone.port";

export function hangupCall(softphone: SoftphonePort | null): void {
  softphone?.hangup();
}
