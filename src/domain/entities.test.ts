import { describe, expect, it } from "vitest";
import { normalizeProtocol } from "@/domain/entities";

describe("normalizeProtocol", () => {
  it("maps sip to sip", () => {
    expect(normalizeProtocol("sip")).toBe("sip");
  });

  it("defaults unknown values to verto", () => {
    expect(normalizeProtocol(undefined)).toBe("verto");
    expect(normalizeProtocol("verto")).toBe("verto");
    expect(normalizeProtocol("")).toBe("verto");
    expect(normalizeProtocol("SIP")).toBe("verto");
  });
});
