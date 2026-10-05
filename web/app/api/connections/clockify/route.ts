import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";
import { saveConnection, getConnection } from "@/lib/db";
import { validateClockifyKey } from "@/lib/clockify";

export async function GET() {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const connection = getConnection(user.id, "clockify");
  if (!connection) return NextResponse.json({ connected: false });
  return NextResponse.json({
    connected: true,
    displayName: connection.display_name,
    metadata: connection.metadata_json ? JSON.parse(connection.metadata_json) : {},
  });
}

export async function POST(request: Request) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { apiKey?: string } | null;
  const apiKey = body?.apiKey?.trim();
  if (!apiKey) return NextResponse.json({ error: "Clockify API key is required" }, { status: 422 });

  try {
    const profile = await validateClockifyKey(apiKey);
    saveConnection({
      userId: user.id,
      provider: "clockify",
      displayName: profile.name || profile.email || "Clockify",
      credentialsEnc: encryptSecret(apiKey),
      metadata: { clockifyUserId: profile.id, email: profile.email ?? null },
    });
    return NextResponse.json({ connected: true, profile: { id: profile.id, name: profile.name, email: profile.email } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Clockify connection failed" }, { status: 400 });
  }
}
