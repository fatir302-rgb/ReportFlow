# Stage 8 — Governance, Versioning and Rollback

Stage 8 closes the control loop around the Stage 7 AI assistant. The model still cannot write Production configuration. Instead, deterministic application code validates, dry-runs, approves and applies a proposal.

## Workflow

1. AI creates a draft with canonical configuration paths.
2. **Test & Preview** compares every affected path against the immutable base snapshot saved when the draft was created.
3. Conflicts block the proposal if Production changed in the meantime.
4. A deterministic dry-run validates report settings, mapped Clockify source IDs, schedules/timezones, connected delivery providers and recipient addresses. Template uploads and currently unsupported PDF execution are blocked rather than guessed.
5. A successful dry-run is required before **Approve**.
6. Approval does not change Production.
7. **Apply to Production** revalidates immediately, runs the mutation inside a database transaction, creates an immutable configuration version, marks the proposal applied and writes an audit event.
8. Version History can restore any older version. Restore never reactivates or deletes history; it copies the older snapshot into a brand-new version.

## Version semantics

- V1 is captured automatically as the baseline before the first governed apply.
- AI applies create V2, V3, ...
- Restoring V2 while V5 is current creates V6 based on V2.
- Template IDs are part of the snapshot, so rollback restores the corresponding retained template version when it still exists.

## Safety boundaries

- AI responses use canonical paths; Production code never interprets a prose field name.
- OAuth/API secrets remain excluded from snapshots and version history.
- Applying an approved proposal performs a fresh stale-state check.
- High-risk and low-risk proposals use the same explicit approval path.
- A missing/deleted delivery connection blocks rollback instead of silently switching senders.
