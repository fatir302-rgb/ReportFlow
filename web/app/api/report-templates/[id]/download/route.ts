import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { currentAppUser } from "@/lib/session";
import { getReportTemplate } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentAppUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const template = getReportTemplate(user.id, id);
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  try {
    const bytes = await readFile(template.storage_path);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": template.extension === ".xlsm" ? "application/vnd.ms-excel.sheet.macroEnabled.12" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(template.original_name)}`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Stored template file is unavailable" }, { status: 410 });
  }
}
