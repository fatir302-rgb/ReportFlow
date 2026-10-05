import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";
import { deleteConnection, saveConnection } from "@/lib/db";

async function validateOpenAIKey(apiKey: string) {
  const model = process.env.REPORTFLOW_AI_MODEL || "gpt-5.6-terra";
  const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (response.ok) return;
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error("OpenAI rejected this API key. Check that it is active and copied completely.");
  if (response.status === 404) throw new Error(`This OpenAI account cannot access the configured Assistant model (${model}).`);
  throw new Error(payload?.error?.message || "OpenAI could not verify this key. Try again shortly.");
}

export async function PUT(request: Request) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => null) as { apiKey?: string } | null;
    const apiKey = String(body?.apiKey || "").trim();
    if (apiKey.length < 20 || /\s/.test(apiKey)) return NextResponse.json({ error: "Enter a complete OpenAI API key without spaces." }, { status: 422 });
    await validateOpenAIKey(apiKey);
    const lastFour = apiKey.slice(-4);
    saveConnection({ userId: user.id, provider: "openai", displayName: `OpenAI key ••••${lastFour}`, credentialsEnc: encryptSecret(apiKey), metadata: { lastFour, validatedAt: new Date().toISOString() } });
    return NextResponse.json({ configured: true, maskedKey: `••••${lastFour}` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to connect OpenAI" }, { status: 400 });
  }
}

export async function DELETE() {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    deleteConnection(user.id, "openai");
    return NextResponse.json({ removed: true, configured: Boolean(process.env.OPENAI_API_KEY) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to remove OpenAI connection" }, { status: 409 });
  }
}
