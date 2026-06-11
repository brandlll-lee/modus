import { describe, expect, it } from "vitest";
import { formatClock } from "./formatClock";

// Fixed reference: Thursday 2026-06-11 14:00 local time.
const now = new Date(2026, 5, 11, 14, 0, 0);

describe("formatClock", () => {
  it("returns an empty string for missing or invalid input", () => {
    expect(formatClock(undefined, now)).toBe("");
    expect(formatClock(0, now)).toBe("");
    expect(formatClock(Number.NaN, now)).toBe("");
  });

  // Labels honor the system locale, so expectations are derived through the
  // same Intl calls — the tests pin down BRANCH selection (today / week / older).
  const timeOf = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  it("shows only the time for today's messages", () => {
    const todayMorning = new Date(2026, 5, 11, 9, 5).getTime();
    expect(formatClock(todayMorning, now)).toBe(timeOf(todayMorning));
  });

  it("shows weekday + time within the last week", () => {
    const monday = new Date(2026, 5, 8, 17, 17).getTime();
    const weekday = new Date(monday).toLocaleDateString([], { weekday: "long" });
    expect(formatClock(monday, now)).toBe(`${weekday} ${timeOf(monday)}`);
  });

  it("shows a short date + time beyond a week", () => {
    const older = new Date(2026, 5, 3, 17, 17).getTime();
    const date = new Date(older).toLocaleDateString([], { month: "short", day: "numeric" });
    const label = formatClock(older, now);
    expect(label).toBe(`${date} ${timeOf(older)}`);
    expect(label).not.toBe(timeOf(older));
  });
});
