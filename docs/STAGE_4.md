# Stage 4 — Shift-Aware Scheduling

Stage 4 turns saved Weekly and Monthly report definitions into timezone-aware schedules and creates a durable, deduplicated execution queue for later report generation/delivery workers.

## Implemented

Each configured weekly/monthly report can now save an independent schedule with:

- enabled/paused state
- `test` or `production` run mode
- IANA timezone (for example `Asia/Karachi`)
- weekly business-week end day
- shift start time
- shift end time
- automatic overnight-shift detection
- delay after shift end before running
- maximum attempts
- base retry delay with exponential backoff
- persisted next-run timestamp
- last-queued timestamp

## Business-date logic

The schedule treats the day on which the shift starts as the **business date**.

Example:

- Weekly business week ends Friday
- Shift starts Friday 20:00
- Shift ends 05:00
- Run delay is 5 minutes

The final Friday shift ends Saturday at 05:00, and the report becomes due Saturday at 05:05. The reporting period still ends on Friday.

For a Friday August 28, 2026 end date in `Asia/Karachi`:

- business reporting period: `2026-08-22` through `2026-08-28`
- source data starts: Saturday August 22 at 20:00 PKT
- source data ends: Saturday August 29 at 05:00 PKT
- scheduled run: Saturday August 29 at 05:05 PKT

This avoids cutting off work performed after midnight during the final business shift.

## Month-end logic

Monthly reports use the final **calendar-day business shift** of the month.

Example:

- August 31 shift starts 20:00 PKT
- shift ends September 1 at 05:00 PKT
- report runs September 1 at 05:05 PKT
- report period remains August 1–31

The execution queue stores both the business-period dates and exact UTC source timestamps.

## Queue and idempotency

`report_run_queue` stores one row per reporting period.

Its unique `run_key` is:

`<report_configuration_id>:<period_start>:<period_end>`

Calling the scheduler repeatedly cannot queue the same weekly/monthly period twice.

The scheduler also performs bounded catch-up: if the service was unavailable when a report became due, subsequent scheduler ticks can enqueue missed periods and advance to the next future occurrence.

## Test vs Production

Every schedule snapshots a run mode into the queue:

- **Test** — later execution will generate/validate the report but must not automatically deliver it.
- **Production** — later execution is eligible for automatic email delivery once Stage 5 delivery settings exist.

No email is sent in Stage 4.

## Retries

Queued jobs carry:

- maximum attempts
- attempt count
- next attempt timestamp
- last error

Failure handling uses exponential backoff from the configured base delay. For a 15-minute base, retry delays are 15, 30, 60 minutes, etc., until the maximum attempt count is reached.

## Scheduler endpoint

A server/cron service can call:

`POST /api/internal/scheduler/tick`

Authenticate with either:

`Authorization: Bearer <REPORTFLOW_SCHEDULER_SECRET>`

or:

`x-reportflow-scheduler-secret: <REPORTFLOW_SCHEDULER_SECRET>`

The endpoint:

1. finds due schedules
2. queues due/missed report periods safely
3. advances `next_run_at`
4. returns currently due pending queue items

It does **not** generate files or send email yet. The Stage 5/6 worker will consume these queue items.

A production scheduler should invoke this endpoint frequently (for example every minute) so a configured 05:05 run is discovered close to its intended time.

## UI

Each Weekly/Monthly report configuration page now includes a Schedule section with:

- scheduled/paused toggle
- Test/Production selection
- timezone
- weekly end day (weekly only)
- shift start/end
- overnight-shift explanation
- post-shift delay
- retry settings
- next three run previews

The Project and Reports overview screens also show whether each report is scheduled.

## Tests

Stage 4 scheduling tests cover:

- Friday-night shift crossing into Saturday
- exact source data boundaries
- August month-end crossing into September
- same-day shift
- next monthly occurrence after a completed month
- next three weekly periods
- U.S. daylight-saving timezone sanity check

The existing Python report-engine tests remain unchanged and passing.
