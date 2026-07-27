import type { NextRequest } from "next/server";

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || "";
}

function normalizeHost(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function isSameOrigin(request: NextRequest) {
  const originValue = request.headers.get("origin");
  if (!originValue) return true;

  let origin: URL;
  try {
    origin = new URL(originValue);
  } catch {
    return false;
  }

  if (origin.origin === request.nextUrl.origin) return true;

  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  if (!host || normalizeHost(origin.host) !== normalizeHost(host)) return false;

  const forwardedProtocol = firstForwardedValue(request.headers.get("x-forwarded-proto"))
    .toLowerCase()
    .replace(/:$/, "");

  return !forwardedProtocol || origin.protocol === `${forwardedProtocol}:`;
}
