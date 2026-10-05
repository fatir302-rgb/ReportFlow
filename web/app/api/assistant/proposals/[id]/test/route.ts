import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { getAIChangeRequest } from "@/lib/db";
import { testProposal } from "@/lib/config-governance";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const proposal = getAIChangeRequest(user.id, id);
  if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  try {
    testProposal(user.id, id);
    return NextResponse.redirect(new URL(`/app/assistant/proposals/${id}?action=tested`, request.url), 303);
  } catch (error) {
    return NextResponse.redirect(new URL(`/app/assistant/proposals/${id}?error=${encodeURIComponent(error instanceof Error ? error.message : "Test failed")}`, request.url), 303);
  }
}
