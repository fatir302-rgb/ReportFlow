import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppUser } from "@/lib/require-app-user";
import { getProject, listConfigurationVersions } from "@/lib/db";

export default async function VersionsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ restored?: string; error?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const user = await requireAppUser();
  const project = getProject(user.id, id);
  if (!project) notFound();
  const versions = listConfigurationVersions(user.id, id);
  const latest = versions[0]?.id;
  return <main className="content">
    <div className="crumb"><Link href={`/app/projects/${id}`}>{project.name}</Link><span>›</span><span>Version history</span></div>
    <div className="page-head"><div><h1>Version history</h1><p className="muted">Every governed apply or restore creates a new immutable version.</p></div><Link className="button" href={`/app/projects/${id}/audit`}>Audit log →</Link></div>
    {query.restored ? <div className="success-panel stage8-banner">Restore completed as new Version {query.restored}.</div> : null}
    {query.error ? <div className="error-panel stage8-banner">{query.error}</div> : null}
    {!versions.length ? <div className="empty-state"><strong>No governed versions yet</strong><p>Version 1 is created automatically before the first AI-approved Production change.</p></div> :
      <div className="version-list">{versions.map((version: any) => <div className="version-row" key={version.id}><div className="version-number">V{version.versionNumber}</div><div className="version-main"><strong>{version.summary}</strong><span>{version.source.replace("_", " ")} · {new Date(version.createdAt).toLocaleString()}</span>{version.restoredFromVersionId ? <small>Created by restoring an earlier version</small> : null}</div><div>{version.id === latest ? <span className="active-version">Current</span> : <form action={`/api/configuration-versions/${version.id}/restore`} method="post"><button type="submit" className="button">Restore as new version</button></form>}</div></div>)}</div>}
  </main>;
}
