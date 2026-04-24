import Dexie, { type EntityTable } from "dexie";

export type CallRecord = {
  id: string;
  account: string;
  number: string;
  name: string;
  direction: "incoming" | "outgoing";
  at: string;
  status: string;
  createdAt: number;
};

const db = new Dexie("SoftphoneDB") as Dexie & {
  calls: EntityTable<CallRecord, "id">;
};

db.version(1).stores({
  calls: "id, account, createdAt",
});

export { db };
