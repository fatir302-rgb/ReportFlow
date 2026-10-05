export type ReportType = "weekly" | "monthly";

export type ScheduleRule = {
  reportType: ReportType;
  timezone: string;
  weeklyStartDay?: number; // 0 = Sunday ... 6 = Saturday. Used only for weekly reports.
  weeklyEndDay: number; // 0 = Sunday ... 6 = Saturday. Used only for weekly reports.
  shiftStartTime: string; // HH:mm on the business date.
  shiftEndTime: string; // HH:mm; if <= start, the shift ends the following calendar day.
  runDelayMinutes: number;
};

export type ScheduledOccurrence = {
  runAt: Date;
  sourceStartAt: Date;
  sourceEndAt: Date;
  businessDate: string;
  periodStart: string;
  periodEnd: string;
};

type LocalDate = { year: number; month: number; day: number };
type LocalDateTime = LocalDate & { hour: number; minute: number; second?: number };

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timezone: string) {
  let formatter = partsFormatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partsFormatterCache.set(timezone, formatter);
  }
  return formatter;
}

function zonedParts(date: Date, timezone: string): Required<LocalDateTime> {
  const values: Record<string, number> = {};
  for (const part of partsFormatter(timezone).formatToParts(date)) {
    if (["year", "month", "day", "hour", "minute", "second"].includes(part.type)) {
      values[part.type] = Number(part.value);
    }
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function timezoneOffsetMs(date: Date, timezone: string) {
  const p = zonedParts(date, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/** Convert a wall-clock time in an IANA timezone into a UTC Date. */
export function localDateTimeToUtc(local: LocalDateTime, timezone: string): Date {
  // Validate the timezone early and provide a useful error rather than silently using local machine time.
  partsFormatter(timezone).format(new Date());
  const naiveUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second ?? 0);
  let guess = new Date(naiveUtc);
  // Two/three passes are enough to converge around DST boundaries without another date library.
  for (let i = 0; i < 3; i += 1) {
    const offset = timezoneOffsetMs(guess, timezone);
    const corrected = new Date(naiveUtc - offset);
    if (Math.abs(corrected.getTime() - guess.getTime()) < 1000) return corrected;
    guess = corrected;
  }
  return guess;
}

function localDateFromUtc(date: Date, timezone: string): LocalDate {
  const p = zonedParts(date, timezone);
  return { year: p.year, month: p.month, day: p.day };
}

function dateOnlyUtc(date: LocalDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function localDateFromDateOnlyUtc(date: Date): LocalDate {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const d = dateOnlyUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return localDateFromDateOnlyUtc(d);
}

function addLocalMonths(date: LocalDate, months: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1 + months, 1));
  return localDateFromDateOnlyUtc(d);
}

function firstDayOfMonth(date: LocalDate): LocalDate {
  return { year: date.year, month: date.month, day: 1 };
}

function lastDayOfMonth(date: LocalDate): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month, 0));
  return localDateFromDateOnlyUtc(d);
}

function weekday(date: LocalDate) {
  return dateOnlyUtc(date).getUTCDay();
}

function resolvedWeeklyStartDay(rule: ScheduleRule) {
  // Existing schedules predate this setting. Treat them as a five-day workweek ending on weeklyEndDay.
  return rule.weeklyStartDay ?? ((rule.weeklyEndDay + 3) % 7);
}

function parseTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid time '${value}'. Expected HH:mm.`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error(`Invalid time '${value}'.`);
  return { hour, minute, minutes: hour * 60 + minute };
}

export function shiftEndDayOffset(startTime: string, endTime: string) {
  const start = parseTime(startTime).minutes;
  const end = parseTime(endTime).minutes;
  return end <= start ? 1 : 0;
}

function formatDate(date: LocalDate) {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function localDateInTimezone(date: Date, timezone: string) {
  return formatDate(localDateFromUtc(date, timezone));
}

function sourceStartForBusinessDate(businessDate: LocalDate, rule: ScheduleRule) {
  const start = parseTime(rule.shiftStartTime);
  return localDateTimeToUtc({ ...businessDate, hour: start.hour, minute: start.minute }, rule.timezone);
}

function sourceEndForBusinessDate(businessDate: LocalDate, rule: ScheduleRule) {
  const end = parseTime(rule.shiftEndTime);
  const endDate = addLocalDays(businessDate, shiftEndDayOffset(rule.shiftStartTime, rule.shiftEndTime));
  return localDateTimeToUtc({ ...endDate, hour: end.hour, minute: end.minute }, rule.timezone);
}

function occurrenceForBusinessDate(businessDate: LocalDate, rule: ScheduleRule): ScheduledOccurrence {
  if (rule.reportType === "weekly") {
    const periodEnd = businessDate;
    const daysInWorkweek = (rule.weeklyEndDay - resolvedWeeklyStartDay(rule) + 7) % 7;
    const periodStart = addLocalDays(periodEnd, -daysInWorkweek);
    const sourceStartAt = sourceStartForBusinessDate(periodStart, rule);
    const sourceEndAt = sourceEndForBusinessDate(periodEnd, rule);
    return {
      runAt: new Date(sourceEndAt.getTime() + Math.max(0, rule.runDelayMinutes) * 60_000),
      sourceStartAt,
      sourceEndAt,
      businessDate: formatDate(businessDate),
      periodStart: formatDate(periodStart),
      periodEnd: formatDate(periodEnd),
    };
  }

  const monthEnd = lastDayOfMonth(businessDate);
  const periodStart = firstDayOfMonth(monthEnd);
  const sourceStartAt = sourceStartForBusinessDate(periodStart, rule);
  const sourceEndAt = sourceEndForBusinessDate(monthEnd, rule);
  return {
    runAt: new Date(sourceEndAt.getTime() + Math.max(0, rule.runDelayMinutes) * 60_000),
    sourceStartAt,
    sourceEndAt,
    businessDate: formatDate(monthEnd),
    periodStart: formatDate(periodStart),
    periodEnd: formatDate(monthEnd),
  };
}

function parseDate(value: string): LocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a valid reporting period.");
  const parsed = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (formatDate(localDateFromDateOnlyUtc(dateOnlyUtc(parsed))) !== value) {
    throw new Error("Choose a valid reporting period.");
  }
  return parsed;
}

/** Build the scheduled occurrence for an explicitly selected, schedule-aligned period end. */
export function occurrenceForPeriodEnd(rule: ScheduleRule, periodEnd: string): ScheduledOccurrence {
  const selected = parseDate(periodEnd);
  if (rule.reportType === "weekly" && weekday(selected) !== rule.weeklyEndDay) {
    throw new Error("The selected date must match the schedule's week-ending day.");
  }
  if (rule.reportType === "monthly" && formatDate(lastDayOfMonth(selected)) !== periodEnd) {
    throw new Error("The selected date must be the final day of a month.");
  }
  return occurrenceForBusinessDate(selected, rule);
}

/** Resolve any selected calendar date to the configured weekly/monthly reporting period containing it. */
export function occurrenceForReferenceDate(rule: ScheduleRule, referenceDate: string): ScheduledOccurrence {
  const selected = parseDate(referenceDate);
  if (rule.reportType === "monthly") return occurrenceForBusinessDate(lastDayOfMonth(selected), rule);

  const startDay = resolvedWeeklyStartDay(rule);
  const workweekLength = (rule.weeklyEndDay - startDay + 7) % 7;
  const daysSinceStart = (weekday(selected) - startDay + 7) % 7;
  const periodEnd = daysSinceStart <= workweekLength
    ? addLocalDays(selected, workweekLength - daysSinceStart)
    : addLocalDays(selected, -(daysSinceStart - workweekLength));
  return occurrenceForBusinessDate(periodEnd, rule);
}

/** Return the reporting period associated with today in the configured timezone, even before it closes. */
export function currentOccurrence(rule: ScheduleRule, at: Date = new Date()): ScheduledOccurrence {
  return occurrenceForReferenceDate(rule, formatDate(localDateFromUtc(at, rule.timezone)));
}

/** Return the most recent period whose configured source shift has finished. */
export function latestClosedOccurrence(rule: ScheduleRule, at: Date = new Date()): ScheduledOccurrence {
  const localToday = localDateFromUtc(at, rule.timezone);
  if (rule.reportType === "weekly") {
    for (let delta = 0; delta >= -14; delta -= 1) {
      const candidate = addLocalDays(localToday, delta);
      if (weekday(candidate) !== rule.weeklyEndDay) continue;
      const occurrence = occurrenceForBusinessDate(candidate, rule);
      if (occurrence.sourceEndAt.getTime() <= at.getTime()) return occurrence;
    }
    throw new Error("Unable to calculate the latest completed weekly period.");
  }

  const currentMonth = firstDayOfMonth(localToday);
  for (let monthOffset = 0; monthOffset >= -2; monthOffset -= 1) {
    const month = addLocalMonths(currentMonth, monthOffset);
    const occurrence = occurrenceForBusinessDate(lastDayOfMonth(month), rule);
    if (occurrence.sourceEndAt.getTime() <= at.getTime()) return occurrence;
  }
  throw new Error("Unable to calculate the latest completed monthly period.");
}

/** Return the first occurrence strictly after `after`. */
export function nextOccurrence(rule: ScheduleRule, after: Date = new Date()): ScheduledOccurrence {
  const weeklyStartDay = resolvedWeeklyStartDay(rule);
  if (!Number.isInteger(weeklyStartDay) || weeklyStartDay < 0 || weeklyStartDay > 6) {
    throw new Error("weeklyStartDay must be between 0 and 6.");
  }
  if (!Number.isInteger(rule.weeklyEndDay) || rule.weeklyEndDay < 0 || rule.weeklyEndDay > 6) {
    throw new Error("weeklyEndDay must be between 0 and 6.");
  }
  // Also validates the timezone.
  const localToday = localDateFromUtc(after, rule.timezone);

  if (rule.reportType === "weekly") {
    for (let delta = 0; delta <= 14; delta += 1) {
      const candidate = addLocalDays(localToday, delta);
      if (weekday(candidate) !== rule.weeklyEndDay) continue;
      const occurrence = occurrenceForBusinessDate(candidate, rule);
      if (occurrence.runAt.getTime() > after.getTime()) return occurrence;
    }
    throw new Error("Unable to calculate the next weekly report occurrence.");
  }

  const currentMonth = firstDayOfMonth(localToday);
  for (let monthOffset = 0; monthOffset <= 24; monthOffset += 1) {
    const candidateMonth = addLocalMonths(currentMonth, monthOffset);
    const occurrence = occurrenceForBusinessDate(lastDayOfMonth(candidateMonth), rule);
    if (occurrence.runAt.getTime() > after.getTime()) return occurrence;
  }
  throw new Error("Unable to calculate the next monthly report occurrence.");
}

export function nextOccurrences(rule: ScheduleRule, count: number, after: Date = new Date()) {
  const results: ScheduledOccurrence[] = [];
  let cursor = after;
  for (let i = 0; i < count; i += 1) {
    const occurrence = nextOccurrence(rule, cursor);
    results.push(occurrence);
    cursor = new Date(occurrence.runAt.getTime() + 1000);
  }
  return results;
}

/**
 * Rebuild the occurrence represented by a persisted next_run_at. This is used by the scheduler
 * while catching up missed runs. We search from a safe point before the scheduled instant.
 */
export function occurrenceAtOrBeforeNextRun(rule: ScheduleRule, nextRunAt: Date): ScheduledOccurrence {
  const searchFrom = new Date(nextRunAt.getTime() - 40 * 24 * 60 * 60 * 1000);
  let cursor = searchFrom;
  for (let i = 0; i < 12; i += 1) {
    const occurrence = nextOccurrence(rule, cursor);
    if (Math.abs(occurrence.runAt.getTime() - nextRunAt.getTime()) < 1000) return occurrence;
    if (occurrence.runAt.getTime() > nextRunAt.getTime()) break;
    cursor = new Date(occurrence.runAt.getTime() + 1000);
  }
  // Persisted schedules created by this service should always match; this fallback keeps the queue safe
  // if an admin manually changes next_run_at.
  const localBusinessDate = localDateFromUtc(nextRunAt, rule.timezone);
  return occurrenceForBusinessDate(
    rule.reportType === "monthly" ? lastDayOfMonth(localBusinessDate) : localBusinessDate,
    rule,
  );
}

export function isValidTimezone(timezone: string) {
  try {
    partsFormatter(timezone).format(new Date());
    return true;
  } catch {
    return false;
  }
}
