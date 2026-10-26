import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { serverConfig } from "@/lib/server-config";
import { COOKIE_NAME, CSRF_HEADER, verifySessionToken } from "@/lib/session";

async function handleProxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(COOKIE_NAME);

  if (!sessionCookie?.value) {
    return NextResponse.json(
      {
        error: {
          code: "unauthorized",
          message: "Authentication required to access gateway resources.",
          statusCode: 401,
        },
      },
      { status: 401 }
    );
  }

  const session = await verifySessionToken(sessionCookie.value);
  if (!session?.adminKey) {
    return NextResponse.json(
      {
        error: {
          code: "unauthorized",
          message: "Invalid or expired session. Please log in again.",
          statusCode: 401,
        },
      },
      { status: 401 }
    );
  }

  // Enforce CSRF protection on mutation methods
  const isMutation = ["POST", "PATCH", "DELETE", "PUT"].includes(request.method);
  if (isMutation) {
    const clientCsrf = request.headers.get(CSRF_HEADER);
    if (!clientCsrf || clientCsrf !== session.csrfToken) {
      return NextResponse.json(
        {
          error: {
            code: "csrf_mismatch",
            message: "Missing or invalid CSRF token.",
            statusCode: 403,
          },
        },
        { status: 403 }
      );
    }
  }

  const { path } = await params;
  const pathStr = path.join("/");
  const search = request.nextUrl.search;
  const targetUrl = `${serverConfig.backendApiUrl}/api/v1/${pathStr}${search}`;

  const forwardHeaders = new Headers();
  forwardHeaders.set("Authorization", `Bearer ${session.adminKey}`);
  forwardHeaders.set("Accept", "application/json");

  const contentType = request.headers.get("content-type");
  if (contentType) {
    forwardHeaders.set("Content-Type", contentType);
  }

  let body: string | undefined = undefined;
  if (isMutation) {
    try {
      body = await request.text();
    } catch {
      // Empty body
    }
  }

  try {
    const backendRes = await fetch(targetUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: body || undefined,
    });

    const resContentType = backendRes.headers.get("content-type") || "";
    if (resContentType.includes("application/json")) {
      const data = await backendRes.json();
      return NextResponse.json(data, { status: backendRes.status });
    }

    const text = await backendRes.text();
    return new NextResponse(text, {
      status: backendRes.status,
      headers: { "Content-Type": resContentType || "text/plain" },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: {
          code: "gateway_unreachable",
          message:
            err instanceof Error
              ? `Proxy unable to reach backend: ${err.message}`
              : "Backend gateway is unreachable.",
          statusCode: 502,
        },
      },
      { status: 502 }
    );
  }
}

export const GET = handleProxy;
export const POST = handleProxy;
export const PATCH = handleProxy;
export const DELETE = handleProxy;
export const PUT = handleProxy;
