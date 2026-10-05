# Stage 7 — Controlled AI Agent

Stage 7 adds a conversational assistant that can inspect ReportFlow configuration and draft structured change proposals. It deliberately cannot mutate Production configuration.

## What it can do

- Answer questions about the selected project's weekly/monthly configuration.
- Translate natural-language requests into structured draft changes.
- Cover project, report, schedule, delivery, Clockify source mapping, and template requests.
- Save a snapshot of the configuration that the proposal was based on.
- Classify proposal risk.
- Preserve conversations and proposal history.
- Let a user discard a draft.

## Safety boundary

The agent code has no apply function. It writes only to `ai_conversations`, `ai_messages`, and `ai_change_requests`. It does not write to `projects`, `report_configurations`, `report_schedules`, `report_delivery_configurations`, or source mapping tables.

OAuth tokens, Clockify API keys, and encrypted connection credentials are excluded from the model snapshot.

## OpenAI

The server calls the Responses API with Structured Outputs (`json_schema`) so a change proposal has a predictable shape. Configure:

```
OPENAI_API_KEY=...
REPORTFLOW_AI_MODEL=gpt-5.6-terra
```

The API key is server-side only.

## Stage 8 handoff

Stage 8 will add deterministic proposal validation, test preview, explicit approval, application transactions, configuration versions, rollback, and audit logs.
