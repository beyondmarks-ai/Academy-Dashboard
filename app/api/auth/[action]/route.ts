import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "bm_session";
const allowedActions = new Set(["login", "signup", "logout"]);

function backendBaseUrl() {
  const value = process.env.ACADEMY_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "";
  if (!value) throw new Error("ACADEMY_API_BASE_URL is not configured.");
  return value.replace(/\/$/, "");
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === request.nextUrl.origin;
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!allowedActions.has(action)) return NextResponse.json({ error: { message: "Not found." } }, { status: 404 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: { message: "Cross-origin request rejected." } }, { status: 403 });

  try {
    const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
    const backendResponse = await fetch(`${backendBaseUrl()}/api/v1/auth/${action}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
        "x-forwarded-for": request.headers.get("x-forwarded-for") || "nextjs-proxy",
        "user-agent": request.headers.get("user-agent") || "Beyond Marks Dashboard",
      },
      body: action === "logout" ? "{}" : await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await backendResponse.json().catch(() => ({}));

    if (!backendResponse.ok) return NextResponse.json(payload, { status: backendResponse.status });

    if (action === "logout") {
      const response = new NextResponse(null, { status: 204 });
      response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
      return response;
    }

    const session = payload?.data?.session;
    if (backendResponse.status === 202 && payload?.data?.profile?.status === "pending") {
      return NextResponse.json({ data: payload.data.profile, requestId: payload.requestId }, { status: 202 });
    }
    if (!session?.token || !session?.maxAge) {
      return NextResponse.json({ error: { message: "The authentication response was incomplete." } }, { status: 502 });
    }
    const response = NextResponse.json({ data: payload.data.profile, requestId: payload.requestId }, { status: backendResponse.status });
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: session.maxAge,
    });
    return response;
  } catch {
    return NextResponse.json({ error: { message: "The authentication service is temporarily unavailable." } }, { status: 502 });
  }
}
