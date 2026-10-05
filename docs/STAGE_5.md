# Stage 5 — Gmail + Outlook Delivery

Stage 5 adds email delivery without coupling it to ReportFlow login identity.

## Connections

A signed-in user can separately connect:

- Gmail, using Google OAuth and the send-only `gmail.send` scope.
- Microsoft Outlook / Microsoft 365, using delegated `Mail.Send` and offline access.

Refresh tokens and access tokens are encrypted at rest with `APP_ENCRYPTION_KEY`.

## Per-report delivery

Weekly and monthly report configurations each have independent delivery settings:

- sender connection (Gmail or Outlook)
- To / CC / BCC
- subject template
- plain-text body template
- attach generated report toggle

Supported template variables:

`{project}`, `{report_type}`, `{period_start}`, `{period_end}`, `{week}`, `{month}`, `{year}`

## Test vs production safety

The Stage 4 schedule run mode controls automatic delivery:

- `test`: delivery is recorded as skipped; no automatic email is sent.
- `production`: delivery is allowed only after a generated report artifact has been registered when attachment delivery is enabled.

The UI also has an explicit **Send test email** button. That sends a real email immediately, but does not attach a report and clearly labels the subject as a ReportFlow test.

## Duplicate protection

`report_delivery_logs.run_id` is unique. A queued report run can therefore create at most one automatic delivery record, preventing duplicate sends during retries or repeated worker calls.

## Provider behavior

Gmail sends a MIME message through `users.messages.send`. Outlook sends JSON through Microsoft Graph `/me/sendMail`, including a file attachment when needed.

## Worker handoff

The report worker writes a generated file to `REPORTFLOW_GENERATED_DIR` and registers it against the queued run. The delivery worker then reads that artifact and sends it when the run is production-enabled.

Internal endpoints:

- `POST /api/internal/runs/artifact`
- `POST /api/internal/delivery/run`

Both require `Authorization: Bearer <REPORTFLOW_SCHEDULER_SECRET>`.

Stage 6 will combine queue processing, report generation, validation, artifact registration, delivery, run history, and manual reruns into one operational worker pipeline.
