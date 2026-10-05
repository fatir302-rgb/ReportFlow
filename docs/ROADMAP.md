# ReportFlow Roadmap

## Stage 1 — Core reporting proof ✅
Clockify data -> normalization -> client-specific Excel renderer -> total validation.

## Stage 2 — App foundation ✅
- Google login wiring
- Microsoft Entra ID login wiring
- User records and linked auth identities
- Encrypted per-user Clockify connections
- Dynamic app projects
- Many Clockify source projects per app project
- Add/edit/delete project flows
- Minimal Notion-style dashboard

OAuth provider registration values are intentionally environment configuration and are not embedded in source.

## Stage 3 — Weekly + monthly report configuration ✅
- Weekly report slot per project
- Monthly report slot per project
- Separate template upload for each report
- XLSX/XLSM template storage
- Desired output format: XLSX/XLSM/PDF
- Filename patterns
- All mapped data vs selected source-project data
- Internal template version history foundation
- Reports overview across projects

## Stage 4 — Shift-aware scheduling ✅
- Weekly business-week end day
- Per-report IANA timezone
- Shift start/end times
- Overnight shifts crossing midnight
- Month-end shift crossing into the next calendar month
- Exact Clockify source timestamps for each queued period
- Post-shift run delay
- Test vs Production run mode
- persisted next-run state
- deduplicated queue/idempotency
- bounded catch-up after scheduler downtime
- retry state and exponential backoff foundation
- scheduler/cron endpoint protected by a secret

## Stage 5 — Gmail + Outlook delivery ✅
- Gmail delivery connection
- Outlook/Microsoft 365 delivery connection
- sender selection independent from login identity
- To/CC/BCC recipients per report
- subject/body templates
- generated report attachments
- Test mode never sends automatically
- Production mode delivery after generation + validation

## Stage 6 — Operations / run history ✅
- Activity dashboard and filters
- operational status derived from queue + artifact + delivery state
- per-run detail view
- secure generated-file download
- failed-run manual retry
- explicit Production resend with separate resend history
- dashboard health counters and recent runs
- user-scoped operational actions

## Stage 7 — AI configuration assistant ✅
- Notion-style Assistant workspace
- Project-scoped or all-project context
- Persistent conversations
- Sanitized configuration snapshots (no connector secrets)
- OpenAI Responses API integration
- Structured Outputs / JSON-schema change plans
- Natural-language answers for existing configuration
- Draft proposals for project/report/schedule/delivery/source/template changes
- risk classification
- immutable base snapshot saved with each proposal
- discard-draft action
- no Production mutation path in the AI endpoint

## Stage 8 — Versioning and governance ✅
- canonical machine-safe configuration paths
- stale-proposal conflict detection
- deterministic Test & Preview dry-run
- explicit approval separate from apply
- transactional Production apply
- immutable project configuration versions
- non-destructive rollback as a new version
- project audit history
- template-version restoration when retained

## Next — Integrated live MVP verification
Run the complete application locally with registered Google/Microsoft OAuth apps, a real Clockify account, real client templates, and end-to-end scheduled/test delivery verification.
