import type {
  SoftphoneCredentials,
  SoftphoneMediaSettings,
  SoftphoneSettings,
} from "@/domain/entities";
import type { SessionStorePort } from "@/domain/session-store.port";

const LEGACY_SETTINGS_KEY = "softphone.verto.settings";
const SESSION_STORAGE_KEY = "softphone.verto.session";
const MEDIA_STORAGE_KEY = "softphone.verto.media";

export const defaultSettings: SoftphoneSettings = {
  websocketUrl: "",
  domain: "default",
  username: "",
  password: "",
  loginUserOnly: false,
  audioInputDeviceId: "",
  audioOutputDeviceId: "",
};

function readSession(): Partial<SoftphoneCredentials> | null {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);

  if (!raw) return null;

  try {
    return JSON.parse(raw) as Partial<SoftphoneCredentials>;
  } catch {
    return null;
  }
}

function writeSession(creds: SoftphoneCredentials): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(creds));
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
        websocketUrl: parsed.websocketUrl,
        domain: parsed.domain,
        username: parsed.username,
        password: parsed.password,
        loginUserOnly: parsed.loginUserOnly,
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
  };
}

export function hasPersistedSession(s: SoftphoneSettings): boolean {
  const ws = s.websocketUrl.trim();
  const user = s.username.trim();
  const pass = s.password.trim();
  const domainOk = s.loginUserOnly || s.domain.trim().length > 0;

  return Boolean(ws && user && pass && domainOk);
}

export const sessionStore: SessionStorePort = {
  write: writeSession,
  clear: clearSession,
};
