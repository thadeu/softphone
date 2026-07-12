import type { SoftphonePort } from "@/domain/softphone.port";

export function sendDtmf(softphone: SoftphonePort | null, digit: string): boolean {
  return softphone?.sendDtmf(digit) ?? false;
}

export async function sendDtmfSequence(
  softphone: SoftphonePort,
  sequence: string,
  gapMs?: number,
): Promise<void> {
  await softphone.sendDtmfSequence(sequence, gapMs);
}
