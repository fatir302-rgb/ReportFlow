export type DeliveryTemplateValues = {
  project: string;
  report_type: "weekly" | "monthly";
  period_start: string;
  period_end: string;
  week: string;
  month: string;
  year: string;
};

export const DELIVERY_VARIABLES = ["project", "report_type", "period_start", "period_end", "week", "month", "year"] as const;

export function renderDeliveryTemplate(template: string, values: DeliveryTemplateValues) {
  return template.replace(/\{(project|report_type|period_start|period_end|week|month|year)\}/g, (_, key: keyof DeliveryTemplateValues) => String(values[key] ?? ""));
}

function isoDate(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

export function deliveryTemplateValues(input: {
  projectName: string;
  reportType: "weekly" | "monthly";
  periodStart: string;
  periodEnd: string;
}): DeliveryTemplateValues {
  const end = isoDate(input.periodEnd);
  const start = isoDate(input.periodStart);
  const firstThursday = new Date(Date.UTC(start.getUTCFullYear(), 0, 4, 12));
  const day = (start.getUTCDay() + 6) % 7;
  const thursday = new Date(start);
  thursday.setUTCDate(start.getUTCDate() - day + 3);
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);
  return {
    project: input.projectName,
    report_type: input.reportType,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    week: String(Math.max(1, week)),
    month: new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(end),
    year: String(end.getUTCFullYear()),
  };
}
