import type { CallRecord } from "./entities";

export type CallHistoryPort = {
  listByAccount(account: string, limit?: number): Promise<CallRecord[]>;
  add(record: CallRecord): Promise<void>;
};
