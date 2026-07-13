import type {
  SoftphoneCredentials,
  SoftphoneMediaSettings,
  SoftphoneSettings,
} from "@/domain/entities";
import { normalizeProtocol } from "@/domain/entities";
import type { SessionStorePort } from "@/domain/session-store.port";

const LEGACY_SETTINGS_KEY = "softphone.verto.settings";
const SESSION_STORAGE_KEY = "softphone.verto.session";
const MEDIA_STORAGE_KEY = "softphone.verto.media";

export const defaultSettings: SoftphoneSettings = {
  protocol: "verto",
  websocketUrl: "",
  domain: "default",
  username: "",
  password: "",
  loginUserOnly: false,
  sipUserAgent: "",
  audioInputDeviceId: "",
  audioOutputDeviceId: "",
};

function readSession(): Partial<SoftphoneCredentials> | null {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SoftphoneCredentials>;

    return {
      ...parsed,
      protocol: normalizeProtocol(parsed.protocol),
      sipUserAgent:
        typeof parsed.sipUserAgent === "string" ? parsed.sipUserAgent : "",
    };
  } catch {
    return null;
  }
}

function writeSession(creds: SoftphoneCredentials): void {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      ...creds,
      protocol: normalizeProtocol(creds.protocol),
    }),
  );
}

function clearSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function readMedia(): SoftphoneMediaSettings {
  const raw = localStorage.getItem(MEDIA_STORAGE_KEY);

  if (!raw) {
    return { audioInputDeviceId: "", audioOutputDeviceId: "" };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SoftphoneSettings>;

    return {
      audioInputDeviceId:
        typeof parsed.audioInputDeviceId === "string" ? parsed.audioInputDeviceId : "",
      audioOutputDeviceId:
        typeof parsed.audioOutputDeviceId === "string" ? parsed.audioOutputDeviceId : "",
    };
  } catch {
    return { audioInputDeviceId: "", audioOutputDeviceId: "" };
  }
}

export function writeMedia(media: SoftphoneMediaSettings): void {
  localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(media));
}

function migrateLegacySettingsIfNeeded(): void {
  if (localStorage.getItem(SESSION_STORAGE_KEY)) return;

  const raw = localStorage.getItem(LEGACY_SETTINGS_KEY);

  if (!raw) return;

  try {
    const parsed = { ...defaultSettings, ...(JSON.parse(raw) as Partial<SoftphoneSettings>) };
    const ws = parsed.websocketUrl.trim();
    const user = parsed.username.trim();
    const pass = parsed.password;

    if (ws && user && pass.trim()) {
      writeSession({
        protocol: normalizeProtocol(parsed.protocol),
        websocketUrl: parsed.websocketUrl,
        domain: parsed.domain,
        username: parsed.username,
        password: parsed.password,
        loginUserOnly: parsed.loginUserOnly,
        sipUserAgent: typeof parsed.sipUserAgent === "string" ? parsed.sipUserAgent : "",
      });
    }

    writeMedia({
      audioInputDeviceId: parsed.audioInputDeviceId,
      audioOutputDeviceId: parsed.audioOutputDeviceId,
    });
  } catch {
    // ignore invalid legacy payload
  }

  localStorage.removeItem(LEGACY_SETTINGS_KEY);
}

export function loadSettings(): SoftphoneSettings {
  migrateLegacySettingsIfNeeded();

  const session = readSession();
  const media = readMedia();

  return {
    ...defaultSettings,
    ...(session ?? {}),
    ...media,
    protocol: normalizeProtocol(session?.protocol ?? defaultSettings.protocol),
    sipUserAgent:
      typeof session?.sipUserAgent === "string" ? session.sipUserAgent : "",
  };
}

export function hasPersistedSession(s: SoftphoneSettings): boolean {
  const ws = s.websocketUrl.trim();
  const user = s.username.trim();
  const pass = s.password.trim();
  const protocol = normalizeProtocol(s.protocol);
  const domainOk =
    protocol === "sip"
      ? s.domain.trim().length > 0
      : s.loginUserOnly || s.domain.trim().length > 0;

  return Boolean(ws && user && pass && domainOk);
}

export const sessionStore: SessionStorePort = {
  write: writeSession,
  clear: clearSession,
};
