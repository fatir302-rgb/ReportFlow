import Link from "next/link";
import { requireAppUser } from "@/lib/require-app-user";
import {
  getAIConversation,
  getAIChangeRequest,
  getConnection,
  listAIConversations,
  listAIConversationMessages,
  listProjects,
} from "@/lib/db";
import { AssistantChat } from "@/components/assistant-chat";
import { AssistantConnection } from "@/components/assistant-connection";

function Risk({ value }: { value: string }) {
  return <span className={`risk-pill risk-${value}`}>{value} risk</span>;
}

export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAppUser();
  const params = await searchParams;
  const requestedConversation = typeof params.conversation === "string" ? params.conversation : null;
  const requestedProject = typeof params.project === "string" ? params.project : null;
  const conversations = listAIConversations(user.id);
  const active = requestedConversation ? getAIConversation(user.id, requestedConversation) : null;
  const messages = active ? listAIConversationMessages(user.id, active.id) : [];
  const projects = listProjects(user.id);
  const selectedProjectId = active?.projectId || requestedProject || "";
  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
  const personalAIConnection = getConnection(user.id, "openai");
  const aiConfigured = Boolean(personalAIConnection || process.env.OPENAI_API_KEY);
  let maskedKey: string | null = null;
  if (personalAIConnection?.metadata_json) {
    try {
      const metadata = JSON.parse(personalAIConnection.metadata_json);
      if (metadata?.lastFour) maskedKey = `••••${String(metadata.lastFour)}`;
    } catch { /* A malformed label must not prevent access to the Assistant. */ }
  }
  const connectionSource = personalAIConnection ? "personal" : process.env.OPENAI_API_KEY ? "server" : "none";

  return (
    <main className="content assistant-page">
      <div className="page-head">
        <div><h1>Assistant</h1><p className="muted">Ask about your configuration or draft a safe change.</p></div>
        {active ? <Link className="button" href="/app/assistant">New conversation</Link> : null}
      </div>

      <AssistantConnection source={connectionSource} maskedKey={maskedKey} />

      <div className="assistant-layout">
        <aside className="assistant-history">
          <div className="assistant-history-title">Conversations</div>
          {conversations.length ? conversations.map((conversation) => (
            <Link className={`assistant-history-row${active?.id === conversation.id ? " active" : ""}`} href={`/app/assistant?conversation=${conversation.id}`} key={conversation.id}>
              <strong>{conversation.title}</strong>
              <span>{conversation.projectName || "All projects"}</span>
            </Link>
          )) : <div className="muted assistant-history-empty">No conversations yet.</div>}
        </aside>

        <section className="assistant-workspace">
          {!active ? (
            <>
              <div className="assistant-welcome">
                <div className="assistant-mark">✦</div>
                <h2>What would you like to change?</h2>
                <p className="muted">Select a project for project-specific requests. You can also ask general questions about your ReportFlow setup.</p>
                <form className="assistant-project-picker" method="get">
                  <label className="label" htmlFor="assistant-project-context">Context</label>
                  <select id="assistant-project-context" className="select" name="project" defaultValue={selectedProjectId}>
                    <option value="">All projects</option>
                    {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
                  </select>
                  <button className="button" type="submit">Use context</button>
                </form>
                <div className="assistant-examples">
                  <span>Try:</span>
                  <div>“What time does this project’s weekly report run?”</div>
                  <div>“Change the monthly output to XLSX.”</div>
                  <div>“Add the new SEO Clockify project to the weekly report.”</div>
                  <div>“Send the monthly report to finance@example.com instead.”</div>
                </div>
              </div>
              <AssistantChat projectId={selectedProject?.id || null} configured={aiConfigured} />
            </>
          ) : (
            <>
              <div className="assistant-context-bar"><span>Context</span><strong>{active.projectName || "All projects"}</strong></div>
              <div className="assistant-thread">
                {messages.map((message) => {
                  const proposal = message.proposalId ? getAIChangeRequest(user.id, message.proposalId) : null;
                  return (
                    <div className={`assistant-message ${message.role}`} key={message.id}>
                      <div className="assistant-role">{message.role === "user" ? "You" : "ReportFlow"}</div>
                      <div className="assistant-bubble">{message.content}</div>
                      {proposal ? (
                        <Link className="proposal-card" href={`/app/assistant/proposals/${proposal.id}`}>
                          <div className="proposal-card-top"><strong>Proposed change</strong><Risk value={proposal.riskLevel} /></div>
                          <div>{proposal.summary}</div>
                          <span>{proposal.plan.changes.length} change{proposal.plan.changes.length === 1 ? "" : "s"} · Review →</span>
                        </Link>
                      ) : null}
                    </div>
                  );
                })}
                {!messages.length ? <div className="empty">Start by asking a question or requesting a configuration change.</div> : null}
              </div>
              <AssistantChat conversationId={active.id} projectId={active.projectId} configured={aiConfigured} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
