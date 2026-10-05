import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppUser } from "@/lib/require-app-user";
import { getProject, listAuditLogs } from "@/lib/db";

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAppUser();
  const project = getProject(user.id, id);
  if (!project) notFound();
  const logs = listAuditLogs(user.id, id, 150);
  return <main className="content">
    <div className="crumb"><Link href={`/app/projects/${id}`}>{project.name}</Link><span>›</span><span>Audit log</span></div>
    <div className="page-head"><div><h1>Audit log</h1><p className="muted">A chronological record of tests, approvals, applies and restores.</p></div><Link className="button" href={`/app/projects/${id}/versions`}>Version history →</Link></div>
    {!logs.length ? <div className="empty-state"><strong>No governance activity yet</strong><p>Stage 8 actions will appear here.</p></div> : <div className="audit-list">{logs.map((log: any) => <div className="audit-row" key={log.id}><div className="audit-dot"/><div><strong>{log.summary}</strong><span>{log.action.replaceAll("_", " ")} · {new Date(log.createdAt).toLocaleString()}</span></div></div>)}</div>}
  </main>;
}
