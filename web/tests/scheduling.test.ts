import assert from "node:assert/strict";
import { currentOccurrence, latestClosedOccurrence, nextOccurrence, nextOccurrences, occurrenceForPeriodEnd, occurrenceForReferenceDate, shiftEndDayOffset } from "../lib/scheduling.ts";

function iso(value: Date) { return value.toISOString(); }

// User-local reference: 2026-08-24 22:35 Asia/Karachi = 17:35Z.
const reference = new Date("2026-08-24T17:35:00.000Z");

const weekly = nextOccurrence({
  reportType: "weekly",
  timezone: "Asia/Karachi",
  weeklyEndDay: 5,
  shiftStartTime: "20:00",
  shiftEndTime: "05:00",
  runDelayMinutes: 5,
}, reference);
assert.equal(shiftEndDayOffset("20:00", "05:00"), 1);
assert.equal(weekly.businessDate, "2026-08-28");
assert.equal(weekly.periodStart, "2026-08-24");
assert.equal(weekly.periodEnd, "2026-08-28");
assert.equal(iso(weekly.runAt), "2026-08-29T00:05:00.000Z"); // 05:05 PKT Saturday

const monthly = nextOccurrence({
  reportType: "monthly",
  timezone: "Asia/Karachi",
  weeklyEndDay: 5,
  shiftStartTime: "20:00",
  shiftEndTime: "05:00",
  runDelayMinutes: 5,
}, reference);
assert.equal(monthly.businessDate, "2026-08-31");
assert.equal(monthly.periodStart, "2026-08-01");
assert.equal(monthly.periodEnd, "2026-08-31");
assert.equal(iso(monthly.runAt), "2026-09-01T00:05:00.000Z"); // 05:05 PKT Sep 1

const sameDay = nextOccurrence({
  reportType: "weekly",
  timezone: "Asia/Karachi",
  weeklyEndDay: 5,
  shiftStartTime: "09:00",
  shiftEndTime: "17:00",
  runDelayMinutes: 5,
}, reference);
assert.equal(shiftEndDayOffset("09:00", "17:00"), 0);
assert.equal(iso(sameDay.runAt), "2026-08-28T12:05:00.000Z"); // 17:05 PKT Friday

const afterAugustRun = new Date("2026-09-01T00:06:00.000Z");
const nextMonth = nextOccurrence({
  reportType: "monthly",
  timezone: "Asia/Karachi",
  weeklyEndDay: 5,
  shiftStartTime: "20:00",
  shiftEndTime: "05:00",
  runDelayMinutes: 5,
}, afterAugustRun);
assert.equal(nextMonth.periodStart, "2026-09-01");
assert.equal(nextMonth.periodEnd, "2026-09-30");
assert.equal(iso(nextMonth.runAt), "2026-10-01T00:05:00.000Z");

const nextThree = nextOccurrences({
  reportType: "weekly",
  timezone: "Asia/Karachi",
  weeklyEndDay: 5,
  shiftStartTime: "20:00",
  shiftEndTime: "05:00",
  runDelayMinutes: 5,
}, 3, reference);
assert.deepEqual(nextThree.map((item) => item.periodEnd), ["2026-08-28", "2026-09-04", "2026-09-11"]);

const selectedWeekly = occurrenceForPeriodEnd({
  reportType: "weekly", timezone: "Asia/Karachi", weeklyEndDay: 5,
  shiftStartTime: "20:00", shiftEndTime: "05:00", runDelayMinutes: 5,
}, "2026-08-28");
assert.equal(selectedWeekly.periodStart, "2026-08-24");
assert.throws(() => occurrenceForPeriodEnd({
  reportType: "weekly", timezone: "Asia/Karachi", weeklyEndDay: 5,
  shiftStartTime: "20:00", shiftEndTime: "05:00", runDelayMinutes: 5,
}, "2026-08-27"), /week-ending day/);

const selectedMonthly = occurrenceForPeriodEnd({
  reportType: "monthly", timezone: "Asia/Karachi", weeklyEndDay: 5,
  shiftStartTime: "20:00", shiftEndTime: "05:00", runDelayMinutes: 5,
}, "2026-08-31");
assert.equal(selectedMonthly.periodStart, "2026-08-01");
assert.throws(() => occurrenceForPeriodEnd({
  reportType: "monthly", timezone: "Asia/Karachi", weeklyEndDay: 5,
  shiftStartTime: "20:00", shiftEndTime: "05:00", runDelayMinutes: 5,
}, "2026-08-30"), /final day/);

const earlyWindow = latestClosedOccurrence({
  reportType: "weekly", timezone: "Asia/Karachi", weeklyEndDay: 5,
  shiftStartTime: "09:00", shiftEndTime: "17:00", runDelayMinutes: 120,
}, new Date("2026-08-28T12:30:00.000Z"));
assert.equal(earlyWindow.periodEnd, "2026-08-28");
assert.equal(iso(earlyWindow.runAt), "2026-08-28T14:00:00.000Z");

const fridayWorkweek = {
  reportType: "weekly" as const,
  timezone: "Asia/Karachi",
  weeklyStartDay: 1,
  weeklyEndDay: 5,
  shiftStartTime: "17:30",
  shiftEndTime: "02:30",
  runDelayMinutes: 60,
};
const selectedFriday = occurrenceForReferenceDate(fridayWorkweek, "2026-09-04");
assert.equal(selectedFriday.periodStart, "2026-08-31");
assert.equal(selectedFriday.periodEnd, "2026-09-04");
assert.equal(iso(selectedFriday.sourceEndAt), "2026-09-04T21:30:00.000Z");
assert.equal(iso(selectedFriday.runAt), "2026-09-04T22:30:00.000Z");
// A Saturday selection is the weekend immediately after the Monday-Friday reporting period.
assert.equal(occurrenceForReferenceDate(fridayWorkweek, "2026-09-05").periodEnd, "2026-09-04");
// Before the overnight Friday shift has ended, the current period is intentionally still selectable.
assert.equal(currentOccurrence(fridayWorkweek, new Date("2026-09-04T12:00:00.000Z")).periodEnd, "2026-09-04");

console.log("Stage 4 scheduling tests passed");
