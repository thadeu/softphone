import type { SoftphonePort } from "@/domain/softphone.port";

export async function answerCall(softphone: SoftphonePort): Promise<void> {
  await softphone.answer();
}
