import type { CallRecord } from "@/domain/entities";
import type { SoftphonePort } from "@/domain/softphone.port";
import type { CallHistoryPort } from "@/domain/call-history.port";
import { recordCall } from "./record-call";

export async function placeCall(
  softphone: SoftphonePort,
  history: CallHistoryPort,
  input: { account: string; number: string; name?: string },
): Promise<CallRecord | null> {
  const number = input.number.trim();

  if (!number) {
    throw new Error("destination is empty");
  }

  const record = await recordCall(history, {
    account: input.account,
    number,
    name: input.name,
    direction: "outgoing",
    status: "dialing",
  });

  await softphone.call(number);

  return record;
}
