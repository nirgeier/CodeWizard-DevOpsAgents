import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth";
import { createCompany } from "@/lib/db";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (!await currentUserId()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const fields = ["name", "domain", "industry", "country", "hq_city"] as const;
  if (!body || fields.some((field) => typeof body[field] !== "string") ||
      !body.name.trim() || body.name.trim().length > 120 ||
      body.domain.length > 253 || (body.domain.trim() && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(body.domain.trim())) ||
      fields.slice(2).some((field) => body[field].length > 120)) {
    return NextResponse.json({ error: "יש להזין שם חברה ופרטים תקינים." }, { status: 400 });
  }
  try {
    const company = await createCompany(body);
    return NextResponse.json({ company }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "החברה כבר קיימת ברשימה.") {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Company creation failed", error);
    return NextResponse.json({ error: "שמירת החברה נכשלה." }, { status: 503 });
  }
}