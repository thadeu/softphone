import { describe, expect, it, vi } from "vitest";
import { registerSession } from "@/application/register-session";
import { disconnectSession } from "@/application/disconnect-session";
import type { SoftphonePort } from "@/domain/softphone.port";
import type { SessionStorePort } from "@/domain/session-store.port";

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

function mockStore(): SessionStorePort {
  return {
    write: vi.fn(),
    clear: vi.fn(),
  };
}

describe("registerSession", () => {
  it("persists credentials then connects", async () => {
    const softphone = mockSoftphone();
    const store = mockStore();
    const creds = {
      protocol: "sip" as const,
      websocketUrl: "wss://sip.example.com",
      domain: "sip.example.com",
      username: "1001",
      password: "secret",
      loginUserOnly: false,
    };

    await registerSession(softphone, store, creds);

    expect(store.write).toHaveBeenCalledWith(creds);
    expect(softphone.connect).toHaveBeenCalledOnce();
  });
});

describe("disconnectSession", () => {
  it("disconnects and clears session", () => {
    const softphone = mockSoftphone();
    const store = mockStore();

    disconnectSession(softphone, store);

    expect(softphone.disconnect).toHaveBeenCalledOnce();
    expect(store.clear).toHaveBeenCalledOnce();
  });

  it("clears session even without softphone", () => {
    const store = mockStore();
    disconnectSession(null, store);
    expect(store.clear).toHaveBeenCalledOnce();
  });
});
