import Dexie, { type EntityTable } from "dexie";
import type { CallRecord } from "@/domain/entities";
import type { CallHistoryPort } from "@/domain/call-history.port";

const db = new Dexie("SoftphoneDB") as Dexie & {
  calls: EntityTable<CallRecord, "id">;
};

db.version(1).stores({
  calls: "id, account, createdAt",
});

export const callHistory: CallHistoryPort = {
  async listByAccount(account: string, limit = 50): Promise<CallRecord[]> {
    const rows = await db.calls
      .where("account")
      .equals(account)
      .reverse()
      .sortBy("createdAt");

    return rows.slice(0, limit);
  },

  async add(record: CallRecord): Promise<void> {
    await db.calls.add(record);
  },
};
