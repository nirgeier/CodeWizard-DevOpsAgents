import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const DEV_PREVIEW_COOKIE = "cw_dev_preview";

export function localPreviewAllowed(hostname: string): boolean {
  return process.env.NODE_ENV === "development" && ["localhost", "127.0.0.1"].includes(hostname);
}

export function authConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY &&
    !process.env.SUPABASE_URL.includes("your-project.supabase.co"));
}

export async function authClient() {
  if (!authConfigured()) throw new Error("Supabase Auth is not configured");
  const store = await cookies();
  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value, options }) => store.set(name, value, options));
        },
      },
    },
  );
}

export async function currentUserId(): Promise<string | null> {
  const hostname = (await headers()).get("host")?.split(":")[0] ?? "";
  if (localPreviewAllowed(hostname) && (await cookies()).get(DEV_PREVIEW_COOKIE)?.value === "1") {
    return "00000000-0000-0000-0000-000000000001";
  }
  if (!authConfigured()) return null;
  const client = await authClient();
  const { data, error } = await client.auth.getClaims();
  return error ? null : data?.claims?.sub ?? null;
}