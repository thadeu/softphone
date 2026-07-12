import type { CallRecord } from "@/domain/entities";
import type { CallHistoryPort } from "@/domain/call-history.port";
import { randomId } from "@/shared/random-id";

export async function recordCall(
  history: CallHistoryPort,
  input: {
    account: string;
    number: string;
    direction: CallRecord["direction"];
    status: string;
    name?: string;
  },
): Promise<CallRecord | null> {
  const clean = input.number.trim();

  if (!clean) {
    return null;
  }

  const record: CallRecord = {
    id: randomId(),
    account: input.account,
    number: clean,
    name: input.name?.trim() || clean,
    direction: input.direction,
    at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    status: input.status,
    createdAt: Date.now(),
  };

  await history.add(record);

  return record;
}
