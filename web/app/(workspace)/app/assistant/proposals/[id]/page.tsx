import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppUser } from "@/lib/require-app-user";
import { getAIChangeRequest, getProposalGovernance } from "@/lib/db";

function GovernancePanel({ governance }: { governance: any }) {
  const validation = governance?.validation as any;
  const test = governance?.test as any;
  return (
    <section className="section-block governance-panel">
      <div className="section-head"><div><h2>Validation & preview</h2><p className="muted">A deterministic dry-run checks the proposal against the current Production configuration.</p></div></div>
      <div className="governance-steps">
        <div><span>1</span><strong>Validate</strong><small>{governance?.validationStatus === "valid" ? "Passed" : governance?.validationStatus === "conflict" ? "Conflict found" : governance?.validationStatus === "blocked" ? "Blocked" : "Not run"}</small></div>
        <div><span>2</span><strong>Test & Preview</strong><small>{governance?.testStatus === "passed" ? "Passed" : governance?.testStatus === "failed" ? "Failed" : "Not run"}</small></div>
        <div><span>3</span><strong>Approve</strong><small>{governance?.approvedAt ? "Approved" : "Waiting"}</small></div>
        <div><span>4</span><strong>Apply</strong><small>{governance?.appliedAt ? "Applied" : "Waiting"}</small></div>
      </div>
      {validation?.conflicts?.length ? <div className="governance-error"><strong>Production changed since this proposal was created.</strong>{validation.conflicts.map((item: any, i: number) => <div key={i}><code>{item.reportType} · {item.path}</code><span>Expected {JSON.stringify(item.expected)} · Current {JSON.stringify(item.current)}</span></div>)}</div> : null}
      {validation?.blocked?.length ? <div className="governance-error"><strong>This proposal cannot be applied yet.</strong>{validation.blocked.map((item: string, i: number) => <div key={i}>{item}</div>)}</div> : null}
      {test?.passed ? <div className="governance-preview"><strong>Dry-run passed. Production is still unchanged.</strong><p className="muted">The proposed values passed type, source mapping, email, schedule and connection checks.</p>{test.schedulePreview ? Object.entries(test.schedulePreview).map(([type, runs]: any) => <div key={type} className="preview-schedule"><span>{type} next runs</span>{runs.map((run: any, i: number) => <small key={i}>{new Date(run.runAt).toLocaleString()} · {run.periodStart} → {run.periodEnd}</small>)}</div>) : null}</div> : null}
    </section>
  );
}

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ action?: string; error?: string; version?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const user = await requireAppUser();
  const proposal = getAIChangeRequest(user.id, id);
  if (!proposal) notFound();
  const governance = getProposalGovernance(user.id, id);
  const canTest = proposal.status === "draft";
  const canApprove = proposal.status === "draft" && governance?.validationStatus === "valid" && governance?.testStatus === "passed";
  const canApply = proposal.status === "approved" && governance?.testStatus === "passed";

  return (
    <main className="content proposal-page">
      <div className="crumb"><Link href={`/app/assistant?conversation=${proposal.conversationId}`}>Assistant</Link><span>›</span><span>Proposal</span></div>
      {query.error ? <div className="error-panel stage8-banner">{query.error}</div> : null}
      {query.action === "applied" ? <div className="success-panel stage8-banner"><strong>Applied to Production.</strong> Version {query.version} was created and can be restored later.</div> : null}
      {query.action === "approved" ? <div className="success-panel stage8-banner">Proposal approved. Production is still unchanged until you press Apply to Production.</div> : null}
      <div className="page-head">
        <div><div className="proposal-eyebrow">{proposal.status} · {proposal.projectName || "General"}</div><h1>{proposal.summary}</h1><p className="muted">{proposal.explanation}</p></div>
        <span className={`risk-pill risk-${proposal.riskLevel}`}>{proposal.riskLevel} risk</span>
      </div>

      <div className={`proposal-safety-note ${proposal.status === "applied" ? "applied-note" : ""}`}>
        <strong>{proposal.status === "applied" ? "This change is active in Production." : "Production has not changed."}</strong>
        <span>{proposal.status === "applied" ? "The previous configuration remains available in Version History." : "Testing and approval happen outside the AI model through deterministic application code."}</span>
      </div>

      <section className="section-block">
        <div className="section-head"><div><h2>Proposed changes</h2><p className="muted">Canonical paths make every approved write deterministic.</p></div></div>
        <div className="proposal-changes">
          {proposal.plan.changes.map((change: any, index: number) => (
            <div className="proposal-change" key={`${change.scope}-${change.field}-${index}`}>
              <div className="proposal-change-head"><span className="proposal-scope">{change.reportType !== "none" ? `${change.reportType} · ` : ""}{change.scope.replace("_", " ")}</span><span className="proposal-action">{change.action.replace("_", " ")}</span></div>
              <strong>{change.field}</strong><div className="proposal-path">{change.path || "Legacy proposal — no canonical path"}</div>
              <div className="change-values"><div><span>Current</span><code>{change.currentValue || "—"}</code></div><div className="change-arrow">→</div><div><span>Proposed</span><code>{change.proposedValue || "—"}</code></div></div>
              <p className="muted">{change.reason}</p>
            </div>
          ))}
        </div>
      </section>

      <GovernancePanel governance={governance} />

      <div className="proposal-actions governance-actions">
        <Link className="button" href={`/app/assistant?conversation=${proposal.conversationId}`}>Back to conversation</Link>
        {proposal.projectId ? <Link className="button" href={`/app/projects/${proposal.projectId}/versions`}>Version history</Link> : null}
        {canTest ? <form action={`/api/assistant/proposals/${proposal.id}/test`} method="post"><button className="button primary" type="submit">Test & Preview</button></form> : null}
        {canApprove ? <form action={`/api/assistant/proposals/${proposal.id}/approve`} method="post"><button className="button primary" type="submit">Approve</button></form> : null}
        {canApply ? <form action={`/api/assistant/proposals/${proposal.id}/apply`} method="post"><button className="button primary" type="submit">Apply to Production</button></form> : null}
        {proposal.status === "draft" ? <form action={`/api/assistant/proposals/${proposal.id}/discard`} method="post"><button className="button danger-button" type="submit">Discard</button></form> : null}
      </div>
    </main>
  );
}
