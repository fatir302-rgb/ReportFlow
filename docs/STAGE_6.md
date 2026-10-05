# Stage 6 — Operations / Run History

Stage 6 turns the scheduling, report-generation and delivery records from Stages 4–5 into a user-facing operations console.

## Activity overview

`/app/activity` shows queued, processing, generated, test, sent and failed runs across all projects. Users can filter by:

- project
- weekly/monthly report type
- operational status
- Test/Production mode
- project name or reporting period search

Summary counters surface sent runs, test runs, work in progress, and items needing attention.

## Run detail

`/app/activity/[runId]` shows:

- project and report type
- reporting period
- exact Clockify source window
- schedule timezone and execution time
- retry attempts
- generated artifact metadata
- Gmail/Outlook delivery state
- sender and recipients
- subject and delivery/run errors
- explicit manual resend history

All run reads and operations are scoped through the signed-in ReportFlow user.

## Download

`GET /api/activity/[runId]/download` streams the registered generated report artifact after ownership validation. Paths are resolved only within `REPORTFLOW_GENERATED_DIR`.

## Retry vs resend

These are intentionally separate operations:

- **Retry** (`POST /api/activity/[runId]/retry`) regenerates a failed or queued run for review, resets automatic attempt state, increments `manual_retry_count`, and preserves the same run identity/deduplication key. It does not send email.
- **Approve & send** (`POST /api/activity/[runId]/approve`) sends a completed, unsent Production artifact only after the user has downloaded/reviewed it and confirmed the current recipients. The existing unique automatic delivery record prevents a double-send.
- **Generate corrected copy** (`POST /api/activity/[runId]/correct`) creates a separate run for the same completed Production period using the current template/configuration. It saves the artifact for review without emailing and preserves the original run and its audit trail.
- **Delete activity** (`POST /api/activity/[runId]/delete`) removes the selected run, its linked artifacts and delivery history, and the stored workbook. Deletion is blocked while generation or delivery is in progress.
- **Resend** (`POST /api/activity/[runId]/resend`) is an explicit human action on a completed Production run. It reuses the already generated artifact and current delivery configuration. Test runs cannot be resent to clients.

Stage 5's automatic `UNIQUE(run_id)` delivery guard remains intact. Explicit human resends are stored separately in `report_resend_logs`, so retries cannot accidentally become duplicate automatic sends and intentional resends remain visible.

## Home health view

The main dashboard now includes basic operational health counts and the five most recent report runs, linking directly into Activity.

## Stage boundary

The scheduler tick also processes due runs in the app, so pending work does not depend on a separate queue consumer. Scheduled Production runs retain automatic delivery. Manual Run now, Retry, and corrected-copy flows stop after artifact generation and require Activity approval before sending. Stage 6 provides operations visibility and manual recovery. The natural-language AI change assistant remains Stage 7, while formal configuration approval, rollback and comprehensive audit governance remain Stage 8.
