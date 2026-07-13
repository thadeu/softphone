export function buildSipUri(userOrDest: string, domain: string): string {
  const value = userOrDest.trim();

  if (!value) {
    throw new Error("SIP user/destination is empty");
  }

  if (value.startsWith("sip:")) {
    return value;
  }

  if (value.includes("@")) {
    return `sip:${value}`;
  }

  const host = domain.trim();

  if (!host) {
    throw new Error("SIP domain is empty");
  }

  return `sip:${value}@${host}`;
}
