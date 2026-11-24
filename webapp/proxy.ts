import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfigured, DEV_PREVIEW_COOKIE, localPreviewAllowed } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // /api/cron/* authenticates itself with CRON_SECRET.
  const open = pathname === "/login" || pathname.startsWith("/auth/") || pathname === "/api/health" ||
    pathname.startsWith("/api/cron/");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const localPreview = localPreviewAllowed(request.nextUrl.hostname);
  if (localPreview && request.cookies.get(DEV_PREVIEW_COOKIE)?.value === "1") {
    return NextResponse.next();
  }
  if (!url || !key || !authConfigured()) {
    if (localPreview) {
      if (open) return NextResponse.next();
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const target = request.nextUrl.clone();
      target.pathname = "/login";
      target.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(target);
    }
    return new NextResponse("Authentication is not configured", { status: 503 });
  }

  let response = NextResponse.next({ request });
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(items, headers) {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });
  const { data } = await client.auth.getClaims();
  if (!data?.claims && !open) {
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = pathname.startsWith("/api/") ? "" : `?next=${encodeURIComponent(pathname)}`;
    const denied = pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      : NextResponse.redirect(target);
    response.cookies.getAll().forEach((cookie) => denied.cookies.set(cookie));
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(header);
      if (value) denied.headers.set(header, value);
    }
    return denied;
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif)$).*)"],
};