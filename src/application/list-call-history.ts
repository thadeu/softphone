import type { CallRecord } from "@/domain/entities";
import type { CallHistoryPort } from "@/domain/call-history.port";

export async function listCallHistory(
  history: CallHistoryPort,
  account: string,
  limit = 50,
): Promise<CallRecord[]> {
  return history.listByAccount(account, limit);
}
