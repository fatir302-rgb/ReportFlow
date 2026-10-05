import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { updateUserDisplayName } from "@/lib/db";

export async function PUT(request: Request) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as any;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 422 });
  if (name.length > 100) return NextResponse.json({ error: "Name must be 100 characters or fewer" }, { status: 422 });
  const updated = updateUserDisplayName(user.id, name);
  if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ user: updated });
}
