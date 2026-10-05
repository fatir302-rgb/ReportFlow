import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { decryptSecret } from "@/lib/crypto";
import { getConnection } from "@/lib/db";
import { getClockifyWorkspaces } from "@/lib/clockify";

export async function GET() {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const connection = getConnection(user.id, "clockify");
  if (!connection) return NextResponse.json({ error: "Connect Clockify first" }, { status: 409 });
  try {
    const workspaces = await getClockifyWorkspaces(decryptSecret(connection.credentials_enc));
    return NextResponse.json({ workspaces });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load workspaces" }, { status: 400 });
  }
}
