import { describe, expect, it } from "vitest";
import { buildSipUri } from "@/adapters/sip/sip-uri";

describe("buildSipUri", () => {
  it("builds sip:user@domain", () => {
    expect(buildSipUri("1001", "sip.example.com")).toBe("sip:1001@sip.example.com");
  });

  it("keeps full sip URI", () => {
    expect(buildSipUri("sip:1001@other.com", "ignored")).toBe("sip:1001@other.com");
  });

  it("prefixes user@host without sip:", () => {
    expect(buildSipUri("1001@sip.example.com", "ignored")).toBe(
      "sip:1001@sip.example.com",
    );
  });

  it("rejects empty user", () => {
    expect(() => buildSipUri("  ", "sip.example.com")).toThrow(/empty/);
  });

  it("rejects missing domain when user has no @", () => {
    expect(() => buildSipUri("1001", "  ")).toThrow(/domain/);
  });
});
