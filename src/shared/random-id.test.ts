import { describe, expect, it } from "vitest";
import { randomId } from "@/shared/random-id";

describe("randomId", () => {
  it("returns RFC4122-ish UUID string", () => {
    const id = randomId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("generates unique values", () => {
    const a = randomId();
    const b = randomId();
    expect(a).not.toBe(b);
  });
});
