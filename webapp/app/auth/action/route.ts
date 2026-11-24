import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authClient, currentUserId, DEV_PREVIEW_COOKIE, localPreviewAllowed } from "@/lib/auth";

export async function POST(request: Request) {
  const origin = process.env.APP_URL || new URL(request.url).origin;
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  const form = await request.formData();
  const action = String(form.get("action") || "");
  const next = String(form.get("next") || "/");
  const destination = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const localPreview = localPreviewAllowed(new URL(request.url).hostname);

  if (action === "preview") {
    if (!localPreview || form.get("preview") !== "on") {
      return NextResponse.json({ error: "Preview unavailable" }, { status: 403 });
    }
    const response = NextResponse.redirect(new URL("/", request.url), 303);
    response.cookies.set(DEV_PREVIEW_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 3600 });
    return response;
  }

  if (action === "signout") {
    if (!localPreview || (await cookies()).get(DEV_PREVIEW_COOKIE)?.value !== "1") {
      const client = await authClient();
      await client.auth.signOut();
    }
    const response = NextResponse.redirect(new URL("/login", origin), 303);
    response.cookies.delete(DEV_PREVIEW_COOKIE);
    return response;
  }

  if (action === "password") {
    if (!await currentUserId()) return NextResponse.redirect(new URL("/login", origin), 303);
    const password = String(form.get("password") || "");
    const confirmation = String(form.get("confirmation") || "");
    if (password.length < 8 || password !== confirmation) {
      return NextResponse.redirect(new URL("/settings?password=invalid", origin), 303);
    }
    const client = await authClient();
    const { error } = await client.auth.updateUser({ password });
    return NextResponse.redirect(new URL(error ? "/settings?password=error" : "/settings?password=updated", origin), 303);
  }

  const provider = String(form.get("provider") || "");
  if (action === "oauth" && ["google", "github", "linkedin_oidc"].includes(provider)) {
    const client = await authClient();
    const callback = new URL("/auth/callback", origin);
    callback.searchParams.set("next", destination);
    const { data, error } = await client.auth.signInWithOAuth({
      provider: provider as "google" | "github" | "linkedin_oidc",
      options: { redirectTo: callback.toString() },
    });
    if (!error && data.url) return NextResponse.redirect(data.url, 303);
  } else if (action === "login" || action === "signup") {
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    if (action === "signup" && password !== String(form.get("confirmation") || "")) {
      const invalid = new URL("/login", origin);
      invalid.searchParams.set("mode", "signup");
      invalid.searchParams.set("message", "mismatch");
      invalid.searchParams.set("next", destination);
      return NextResponse.redirect(invalid, 303);
    }
    if (email && password.length >= 8) {
      const client = await authClient();
      const result = action === "login"
        ? await client.auth.signInWithPassword({ email, password })
        : await client.auth.signUp({ email, password, options: { emailRedirectTo: new URL("/auth/callback", origin).toString() } });
      if (!result.error) {
        return NextResponse.redirect(new URL(result.data.session ? destination : "/login?message=confirm", origin), 303);
      }
    }
  }
  const failed = new URL("/login", origin);
  failed.searchParams.set("message", "error");
  if (action === "signup") failed.searchParams.set("mode", "signup");
  failed.searchParams.set("next", destination);
  return NextResponse.redirect(failed, 303);
}