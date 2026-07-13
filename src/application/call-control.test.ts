import { describe, expect, it, vi } from "vitest";
import { rejectCall } from "@/application/reject-call";
import { hangupCall } from "@/application/hangup-call";
import type { SoftphonePort } from "@/domain/softphone.port";

function mockSoftphone(partial: Partial<SoftphonePort> = {}): SoftphonePort {
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
    ...partial,
  };
}

describe("rejectCall", () => {
  it("defaults to SIP 488", () => {
    const softphone = mockSoftphone();
    rejectCall(softphone);
    expect(softphone.reject).toHaveBeenCalledWith(488);
  });

  it("forwards custom status code", () => {
    const softphone = mockSoftphone();
    rejectCall(softphone, 403);
    expect(softphone.reject).toHaveBeenCalledWith(403);
  });

  it("no-ops when softphone is null", () => {
    expect(() => rejectCall(null)).not.toThrow();
  });
});

describe("hangupCall", () => {
  it("delegates hangup", () => {
    const softphone = mockSoftphone();
    hangupCall(softphone);
    expect(softphone.hangup).toHaveBeenCalledOnce();
  });

  it("no-ops when softphone is null", () => {
    expect(() => hangupCall(null)).not.toThrow();
  });
});
