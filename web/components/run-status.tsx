import type { OperationalRunStatus } from "@/lib/types";

const labels: Record<OperationalRunStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  generated: "Generated",
  sent: "Sent",
  test: "Test",
  failed: "Failed",
  delivery_failed: "Delivery failed",
};

export function RunStatus({ status }: { status: OperationalRunStatus }) {
  return <span className={`run-status status-${status}`}>{labels[status]}</span>;
}
