import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { resendReportRun } from "@/lib/run-operations";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json(await resendReportRun(user.id, id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to resend report" }, { status: 409 });
  }
}
