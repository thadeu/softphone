/** Align with Atende voip-app defaults against Kamailio SBC. */
export const SIP_REGISTER_EXPIRES_SEC = 15;

export const DEFAULT_STUN_URLS = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
  "stun:global.stun.twilio.com:3478",
] as const;

export type IceAuth = {
  host: string;
  username: string;
  password: string;
};

/**
 * STUN + TURN matching Atende softphone (turn:host:80 udp/tcp).
 * Host is typically the Kamailio domain / websocket hostname.
 */
export function buildRtcConfiguration(auth: IceAuth): RTCConfiguration {
  const host = auth.host.trim();
  const username = auth.username.trim();
  const credential = auth.password;

  const iceServers: RTCIceServer[] = DEFAULT_STUN_URLS.map((urls) => ({ urls }));

  if (host && username) {
    iceServers.push(
      {
        urls: `turn:${host}:80?transport=udp`,
        username,
        credential,
      },
      {
        urls: `turn:${host}:80?transport=tcp`,
        username,
        credential,
      },
    );
  }

  return { iceServers };
}

/** Prefer websocket hostname when available; fall back to SIP domain. */
export function resolveIceHost(websocketUrl: string, domain: string): string {
  try {
    const normalized = websocketUrl.trim().replace(/^ws/i, "http");
    const hostname = new URL(normalized).hostname;

    if (hostname) {
      return hostname;
    }
  } catch {
    // ignore invalid websocket URL
  }

  return domain.trim();
}
