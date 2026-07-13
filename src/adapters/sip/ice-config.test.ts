import { describe, expect, it } from "vitest";
import {
  DEFAULT_STUN_URLS,
  SIP_REGISTER_EXPIRES_SEC,
  buildRtcConfiguration,
  resolveIceHost,
} from "@/adapters/sip/ice-config";

describe("ice-config", () => {
  it("uses Atende-aligned register expires", () => {
    expect(SIP_REGISTER_EXPIRES_SEC).toBe(15);
  });

  it("resolves host from websocket URL", () => {
    expect(resolveIceHost("wss://instance101.example.com", "fallback")).toBe(
      "instance101.example.com",
    );
    expect(resolveIceHost("ws://kamailio.local:8080/ws", "fallback")).toBe(
      "kamailio.local",
    );
  });

  it("falls back to domain when websocket URL is invalid", () => {
    expect(resolveIceHost("not-a-url", "sip.example.com")).toBe("sip.example.com");
  });

  it("builds STUN + TURN servers like Atende voip-app", () => {
    const cfg = buildRtcConfiguration({
      host: "instance101.example.com",
      username: "5511999990001",
      password: "12345",
    });

    const urls = (cfg.iceServers ?? []).flatMap((s) =>
      Array.isArray(s.urls) ? s.urls : [s.urls],
    );

    for (const stun of DEFAULT_STUN_URLS) {
      expect(urls).toContain(stun);
    }

    expect(urls).toContain("turn:instance101.example.com:80?transport=udp");
    expect(urls).toContain("turn:instance101.example.com:80?transport=tcp");

    const turn = (cfg.iceServers ?? []).find((s) =>
      String(s.urls).includes("turn:"),
    );
    expect(turn?.username).toBe("5511999990001");
    expect(turn?.credential).toBe("12345");
  });

  it("omits TURN when host is empty", () => {
    const cfg = buildRtcConfiguration({
      host: "",
      username: "u",
      password: "p",
    });

    const urls = (cfg.iceServers ?? []).flatMap((s) =>
      Array.isArray(s.urls) ? s.urls : [s.urls],
    );

    expect(urls.every((u) => String(u).startsWith("stun:"))).toBe(true);
  });
});
