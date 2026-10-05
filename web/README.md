# ReportFlow Web — Stages 2–8

The web application now contains the Stage 2 app foundation, Stage 3 Weekly/Monthly report configuration, Stage 4 shift-aware scheduling, Stage 5 Gmail/Outlook delivery, Stage 6 operations/run history, Stage 7 controlled AI configuration assistant, and Stage 8 governance/versioning.

## Implemented

- Minimal Notion-inspired UI
- Google OAuth login via Auth.js
- Microsoft Entra ID OAuth login via Auth.js
- One local user record can link multiple OAuth identities by email
- SQLite development database
- User-scoped Clockify connections
- AES-256-GCM encryption for Clockify API keys at rest
- Dynamic app projects
- One app project can map to one or many Clockify projects
- Project list and project detail screens
- Three-step Add Project wizard
- Clockify workspace/project discovery happens server-side
- Dev preview mode for UI testing before OAuth credentials are configured

## Run locally

1. Install Node.js 20.9 or newer and Python 3.11 or newer.
2. Copy env file:
   `cp .env.example .env.local`
3. Run `npm run secure:env` to replace placeholder secrets safely. If connector credentials already exist, the command re-encrypts them under the new key.
4. For local UI-only preview, set `DEV_BYPASS_AUTH=true`. Production startup rejects this setting.
5. Install dependencies: `npm install`
   Install the report engine dependencies in the repository-level `.venv` as described in the root README. ReportFlow uses that Python automatically; set `REPORTFLOW_PYTHON` only when using a different interpreter.
6. Check the environment safely without printing secret values: `npm run check:env`
7. Run: `npm run dev`
8. Open `http://localhost:3000`

## Quality checks

```powershell
npm run lint
npm test
npm run build
npm run check:env:production
```

The production environment check also rejects placeholder secrets and development authentication bypass. Do not rotate `APP_ENCRYPTION_KEY` after saving connector credentials unless those credentials will be reconnected, because existing encrypted values depend on that key.

For real Google/Microsoft login, create OAuth applications and fill the provider values in `.env.local`.

## OAuth callback URLs

Google:
`http://localhost:3000/api/auth/callback/google`

Microsoft Entra ID:
`http://localhost:3000/api/auth/callback/microsoft-entra-id`

Use production HTTPS URLs when deployed.

## Important architecture boundary

Login permissions and delivery permissions are intentionally separate. Google/Microsoft sign-in only establishes identity. Gmail/Outlook delivery uses separate explicit sending connections and scopes.

The existing Python report engine remains in `../app`. Stage 3 attaches Weekly/Monthly templates to dynamic projects, and Stage 4 adds their execution schedules and queue state. Assistant users can connect their own OpenAI API key from the Assistant page; it is validated and encrypted at rest. `OPENAI_API_KEY` remains an optional shared server fallback.

## Stage 4 scheduling

Weekly and Monthly report pages now include timezone-aware scheduling. Overnight shifts remain attached to their starting business date, month-end shifts may complete in the following calendar month, and every due period is placed into an idempotent queue with exact source-data boundaries.

Set `REPORTFLOW_SCHEDULER_SECRET` and call `POST /api/internal/scheduler/tick` from a trusted cron. The endpoint queues due periods and processes up to ten pending runs in the same app, generating the artifact and delivering it in Production mode.

See `../docs/STAGE_4.md`.

## Stage 5 — Gmail and Outlook delivery

The Connections page can now connect Gmail and Microsoft Outlook independently from login identity. Configure the OAuth callback URLs as:

- `http://localhost:3000/api/connections/gmail/callback`
- `http://localhost:3000/api/connections/outlook/callback`

Each Weekly/Monthly report now has a Delivery section for sender, To/CC/BCC, subject/body templates, attachment preference, and a manual test-email action.

Automatic scheduled delivery honors Stage 4 run mode: test runs never auto-send; production runs are idempotent and require a registered generated artifact when `Attach report` is enabled.


## Stage 6 — Operations / run history

The Activity screen now shows operational status across queued runs, generated files, and Gmail/Outlook delivery. Manual Run now, Retry, and corrected-copy generation save a reviewable artifact without sending; users can download it and approve delivery from Activity. Scheduled Production runs remain automatic. Explicit resends are recorded separately from the automatic one-delivery-per-run guard. See `../docs/STAGE_6.md`.


## Stage 7 — AI assistant

Add `OPENAI_API_KEY` to `.env.local` and optionally set `REPORTFLOW_AI_MODEL` (default `gpt-5.6-terra`). The Assistant page can answer configuration questions and create structured draft proposals. It cannot mutate Production configuration. Drafts now flow through Stage 8 deterministic Test & Preview, explicit approval, Production apply, immutable configuration versions, rollback-as-new-version, and audit history.

See `../docs/STAGE_7.md` and `../docs/STAGE_8.md`.
