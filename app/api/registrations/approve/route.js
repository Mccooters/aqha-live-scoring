import { NextResponse } from "next/server";
import { adminClient, approveRegistration } from "../../_lib/registrations";

export async function POST(req) {
  try {
    const { registration_id } = await req.json();
    if (!registration_id) {
      return NextResponse.json({ error: "registration_id required" }, { status: 400 });
    }

    const db = adminClient();

    const { data: reg } = await db
      .from("registrations")
      .select("id, status")
      .eq("id", registration_id)
      .single();

    if (!reg) return NextResponse.json({ error: "Registration not found" }, { status: 404 });
    if (reg.status === "paid") return NextResponse.json({ error: "Already paid" }, { status: 400 });

    await approveRegistration(db, registration_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
