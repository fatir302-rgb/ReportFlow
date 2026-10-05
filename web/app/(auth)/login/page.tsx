import { signIn } from "@/auth";
import { isDevAuthBypassEnabled } from "@/lib/runtime-config";

export default function LoginPage() {
  const preview = isDevAuthBypassEnabled();
  return (
    <main className="auth-page">
      <div className="auth-shell">
        <section className="auth-brand-panel">
          <div className="auth-brand"><span className="brand-mark">R</span><strong>ReportFlow</strong></div>
          <div><span className="auth-eyebrow">Automated reporting workspace</span><h1>Turn time entries into polished client reports.</h1><p>Connect Clockify, schedule recurring reports, and deliver them through Gmail or Outlook—with a clear audit trail.</p></div>
          <div className="auth-feature-list"><span>✓ Reusable Excel templates</span><span>✓ Shift-aware scheduling</span><span>✓ Safe delivery and recovery</span></div>
        </section>
        <section className="auth-card">
          <span className="auth-eyebrow">Welcome back</span>
          <h2 className="auth-title">Sign in to your workspace</h2>
          <p className="auth-subtitle">Choose the account you use for ReportFlow.</p>
          <form action={async () => { "use server"; await signIn("google", { redirectTo: "/app" }); }}>
            <button className="oauth-button" type="submit"><span className="provider-mark google">G</span>Continue with Google<span className="oauth-arrow">→</span></button>
          </form>
          <form action={async () => { "use server"; await signIn("microsoft-entra-id", { redirectTo: "/app" }); }}>
            <button className="oauth-button" type="submit"><span className="provider-mark microsoft">M</span>Continue with Microsoft<span className="oauth-arrow">→</span></button>
          </form>
          {preview && <a className="preview-link" href="/app">Preview dashboard without OAuth</a>}
          <p className="auth-legal">Signing in authenticates your ReportFlow account. Mailbox delivery permissions are connected separately.</p>
        </section>
      </div>
    </main>
  );
}
