import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { applyApprovedProposal } from "@/lib/config-governance";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const version = applyApprovedProposal(user.id, id);
    return NextResponse.redirect(new URL(`/app/assistant/proposals/${id}?action=applied&version=${version.versionNumber}`, request.url), 303);
  } catch (error) {
    return NextResponse.redirect(new URL(`/app/assistant/proposals/${id}?error=${encodeURIComponent(error instanceof Error ? error.message : "Apply failed")}`, request.url), 303);
  }
}
