import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { discardAIChangeRequest, getAIChangeRequest } from "@/lib/db";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const proposal = getAIChangeRequest(user.id, id);
  if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  discardAIChangeRequest(user.id, id);
  return NextResponse.redirect(new URL(`/app/assistant?conversation=${proposal.conversationId}`, _request.url), 303);
}
