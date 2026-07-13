import { describe, expect, it, vi } from "vitest";
import { recordCall } from "@/application/record-call";
import { placeCall } from "@/application/place-call";
import type { CallHistoryPort } from "@/domain/call-history.port";
import type { SoftphonePort } from "@/domain/softphone.port";
import type { CallRecord } from "@/domain/entities";

function mockHistory(store: CallRecord[] = []): CallHistoryPort {
  return {
    async listByAccount() {
      return store;
    },
    async add(record) {
      store.push(record);
    },
  };
}

function mockSoftphone(): SoftphonePort {
  return {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    call: vi.fn(async () => undefined),
    answer: vi.fn(async () => undefined),
    reject: vi.fn(),
    hangup: vi.fn(),
    setMuted: vi.fn(),
    sendDtmf: vi.fn(() => false),
    sendDtmfSequence: vi.fn(async () => undefined),
    canSendDtmf: vi.fn(() => false),
  };
}

describe("recordCall", () => {
  it("persists outgoing record", async () => {
    const store: CallRecord[] = [];
    const history = mockHistory(store);

    const record = await recordCall(history, {
      account: "1001@default",
      number: "2002",
      direction: "outgoing",
      status: "dialing",
    });

    expect(record).not.toBeNull();
    expect(record?.number).toBe("2002");
    expect(store).toHaveLength(1);
  });

  it("skips blank number", async () => {
    const history = mockHistory();
    const record = await recordCall(history, {
      account: "a",
      number: "   ",
      direction: "incoming",
      status: "ringing",
    });
    expect(record).toBeNull();
  });
});

describe("placeCall", () => {
  it("records then invites", async () => {
    const store: CallRecord[] = [];
    const history = mockHistory(store);
    const softphone = mockSoftphone();

    const record = await placeCall(softphone, history, {
      account: "1001@default",
      number: "2002",
    });

    expect(record?.direction).toBe("outgoing");
    expect(softphone.call).toHaveBeenCalledWith("2002");
    expect(store).toHaveLength(1);
  });

  it("throws on empty destination", async () => {
    await expect(
      placeCall(mockSoftphone(), mockHistory(), {
        account: "a",
        number: " ",
      }),
    ).rejects.toThrow(/destination/);
  });
});
