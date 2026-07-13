import type { SoftphonePort } from "@/domain/softphone.port";

/** Decline ringing inbound call. Default SIP status matches Atende voip-app (488). */
export function rejectCall(
  softphone: SoftphonePort | null,
  statusCode = 488,
): void {
  softphone?.reject(statusCode);
}
