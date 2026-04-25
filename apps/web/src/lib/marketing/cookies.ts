export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  const parts = document.cookie ? document.cookie.split(";") : [];
  for (const raw of parts) {
    const trimmed = raw.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

export function writeCookie(
  name: string,
  value: string,
  options: {
    maxAgeSeconds: number;
    sameSite?: "Lax" | "Strict" | "None";
    secure?: boolean;
    path?: string;
  },
): void {
  if (typeof document === "undefined") return;
  const {
    maxAgeSeconds,
    sameSite = "Lax",
    secure = true,
    path = "/",
  } = options;
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAgeSeconds}`,
    `Path=${path}`,
    `SameSite=${sameSite}`,
  ];
  if (secure && window.location.protocol === "https:") {
    parts.push("Secure");
  }
  document.cookie = parts.join("; ");
}

export function deleteCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Max-Age=0; Path=/`;
}
