import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "bm_session";
const allowedMethods = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

function backendBaseUrl() {
  const value = process.env.ACADEMY_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "";
  if (!value) throw new Error("ACADEMY_API_BASE_URL is not configured.");
  return value.replace(/\/$/, "");
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!allowedMethods.has(request.method) || path[0] !== "v1" || path[1] === "auth") {
    return NextResponse.json({ error: { message: "Not found." } }, { status: 404 });
  }

  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: { message: "Cross-origin request rejected." } }, { status: 403 });
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionToken) return NextResponse.json({ error: { message: "Please log in to continue." } }, { status: 401 });

  try {
    const query = request.nextUrl.search;
    const backendResponse = await fetch(`${backendBaseUrl()}/api/${path.map(encodeURIComponent).join("/")}${query}`, {
      method: request.method,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        ...(request.headers.get("content-type") ? { "content-type": request.headers.get("content-type")! } : {}),
        "x-forwarded-for": request.headers.get("x-forwarded-for") || "nextjs-proxy",
        "user-agent": request.headers.get("user-agent") || "Beyond Marks Dashboard",
      },
      body: request.method === "GET" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const body = backendResponse.status === 204 ? null : await backendResponse.arrayBuffer();
    return new NextResponse(body, {
      status: backendResponse.status,
      headers: {
        "content-type": backendResponse.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: { message: "The Academy API is temporarily unavailable." } }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
