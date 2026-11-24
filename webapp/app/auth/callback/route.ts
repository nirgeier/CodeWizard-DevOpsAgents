import { NextResponse } from "next/server";
import { authClient } from "@/lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/";
  if (code) {
    const client = await authClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next.startsWith("/") && !next.startsWith("//") ? next : "/", url.origin));
    }
  }
  return NextResponse.redirect(new URL("/login?message=error", url.origin));
}