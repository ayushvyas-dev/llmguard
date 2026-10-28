import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api-client";
import { getDirectBackendClient } from "@/lib/server-api";
import { createSessionToken, getSessionCookieConfig } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const isDemo = body?.isDemo === true;
    let adminKey = body?.adminKey?.trim();

    if (isDemo && !adminKey) {
      adminKey = process.env.DEMO_ADMIN_KEY || "lga_dev_demo0000_recruiter_demo_access_key";
    }

    if (!adminKey) {
      return NextResponse.json(
        { error: "Admin API key is required." },
        { status: 400 }
      );
    }

    // Verify key with backend by testing an admin endpoint
    const backend = getDirectBackendClient(adminKey);
    try {
      await backend.get("/api/v1/admin/metrics/overview");
    } catch (err: unknown) {
      if (err instanceof ApiError && err.statusCode === 401) {
        return NextResponse.json(
          { error: "Invalid admin API key. Please check your credentials." },
          { status: 401 }
        );
      }
      if (err instanceof ApiError && err.statusCode === 403) {
        return NextResponse.json(
          { error: "Provided key does not have administrator privileges." },
          { status: 403 }
        );
      }
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? `Gateway backend error: ${err.message}`
              : "Unable to verify admin key with gateway backend.",
        },
        { status: 502 }
      );
    }

    // Create session token and CSRF token
    const { token, csrfToken } = await createSessionToken(adminKey, "admin");

    const cookieConfig = getSessionCookieConfig();
    const response = NextResponse.json({
      success: true,
      role: "admin",
      csrfToken,
    });

    response.cookies.set({
      name: cookieConfig.name,
      value: token,
      httpOnly: cookieConfig.httpOnly,
      secure: cookieConfig.secure,
      sameSite: cookieConfig.sameSite,
      path: cookieConfig.path,
      maxAge: cookieConfig.maxAge,
    });

    response.cookies.set({
      name: "llmguard_csrf",
      value: csrfToken,
      httpOnly: false,
      secure: cookieConfig.secure,
      sameSite: cookieConfig.sameSite,
      path: cookieConfig.path,
      maxAge: cookieConfig.maxAge,
    });

    return response;
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
