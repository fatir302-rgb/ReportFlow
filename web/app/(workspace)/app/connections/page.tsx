import { requireAppUser } from "@/lib/require-app-user";
import { getConnection, listDeliveryConnections } from "@/lib/db";
import { ClockifyConnectionForm } from "@/components/clockify-connection-form";
import { EmailConnectionActions } from "@/components/email-connection-actions";

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const user = await requireAppUser();
  const params = await searchParams;
  const clockify = getConnection(user.id, "clockify");
  const emailConnections = listDeliveryConnections(user.id);
  const gmail = emailConnections.find((item) => item.provider === "gmail");
  const outlook = emailConnections.find((item) => item.provider === "outlook");
  const outlookConfigured = Boolean(
    (process.env.MICROSOFT_DELIVERY_CLIENT_ID || process.env.AUTH_MICROSOFT_ENTRA_ID_ID) &&
    (process.env.MICROSOFT_DELIVERY_CLIENT_SECRET || process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET),
  );
  return (
    <main className="content">
      <div className="page-head"><div><h1>Connections</h1><p className="muted">Connect data sources and the mailboxes ReportFlow may use for report delivery.</p></div></div>
      {params.connected && <p className="success connection-notice">{params.connected === "gmail" ? "Gmail" : "Outlook"} connected successfully.</p>}
      {params.error && <p className="error connection-notice">{params.error}</p>}
      <h2 style={{ marginBottom: 12 }}>Data sources</h2>
      <ClockifyConnectionForm connected={Boolean(clockify)} displayName={clockify?.display_name} />
      <h2 style={{ margin: "34px 0 6px" }}>Email delivery</h2>
      <p className="muted" style={{ margin: "0 0 12px" }}>Connecting a mailbox only grants delivery permission. It is separate from Google/Microsoft sign-in.</p>
      <EmailConnectionActions provider="gmail" connected={Boolean(gmail)} displayName={gmail?.displayName} />
      <EmailConnectionActions provider="outlook" connected={Boolean(outlook)} displayName={outlook?.displayName} configured={outlookConfigured} />
    </main>
  );
}
