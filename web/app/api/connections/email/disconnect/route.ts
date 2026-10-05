import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { deleteConnection } from "@/lib/db";

export async function DELETE(request: Request) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { provider?: string } | null;
  const provider = body?.provider;
  if (provider !== "gmail" && provider !== "outlook") return NextResponse.json({ error: "Invalid provider" }, { status: 422 });
  try {
    deleteConnection(user.id, provider);
    return NextResponse.json({ disconnected: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to disconnect" }, { status: 409 });
  }
}
