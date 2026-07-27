import { addMinutes } from 'date-fns';
import { wallClockToUtc, formatInTz } from '@/common/time/tz.util';

/** Step between consecutive slots when a window doesn't specify its own. */
export const DEFAULT_SLOT_INTERVAL = 30;

/** Extract the wall-clock time-of-day ("HH:mm") from a Time column value. */
// working_hours / blocked_time store time-of-day as 1970-01-01T<HH:mm>:00Z, so
// the UTC fields ARE the intended wall-clock time, independent of any timezone.
export function timeOfDay(t: Date): string {
  return t.toISOString().substring(11, 16);
}

/** The calendar date (yyyy-MM-dd) a date-only column holds (stored as UTC midnight). */
export function dateOnly(d: Date): string {
  return d.toISOString().substring(0, 10);
}

/** One open window on a weekday — a day can have several (split shift). */
export interface SlotWindow {
  start_time: Date;
  end_time: Date;
  /** Minutes between slot starts inside this window. Null/0 → DEFAULT_SLOT_INTERVAL. */
  slot_interval_minutes?: number | null;
}

export interface DaySlotInput {
  /** Calendar date being computed, "yyyy-MM-dd", in the clinic timezone. */
  dateStr: string;
  /** Clinic IANA timezone, e.g. "Europe/Athens" / "Asia/Nicosia". */
  tz: string;
  /** Every open window for this weekday (time-of-day columns), in any order. */
  windows: SlotWindow[];
  blocked: { date: Date; start_time: Date; end_time: Date }[];
  appointments: { start_time: Date; end_time: Date }[];
  durationMinutes: number;
  bufferMinutes?: number;
  /** Injectable "now" for deterministic tests. Defaults to the real now. */
  now?: Date;
}

/**
 * Generate the available "HH:mm" slots for a single day — entirely in terms of
 * absolute instants, so the result does NOT depend on the server's local
 * timezone. Wall-clock working hours are anchored to the clinic timezone; booked
 * appointments (already UTC instants) and blocked times are compared as instants.
 *
 * Windows are walked independently, so a morning and an afternoon shift each get
 * their own grid (and their own slot interval). The union is deduped and sorted,
 * which also makes overlapping windows harmless.
 */
export function computeDaySlots(input: DaySlotInput): string[] {
  const {
    dateStr,
    tz,
    windows,
    blocked,
    appointments,
    durationMinutes,
    bufferMinutes = 0,
  } = input;
  const nowMs = (input.now ?? new Date()).getTime();

  const busy: { start: number; end: number }[] = [
    ...blocked.map((b) => {
      const d = dateOnly(b.date);
      return {
        start: wallClockToUtc(d, timeOfDay(b.start_time), tz).getTime(),
        end: wallClockToUtc(d, timeOfDay(b.end_time), tz).getTime(),
      };
    }),
    ...appointments.map((a) => ({
      start: a.start_time.getTime(),
      end: a.end_time.getTime() + bufferMinutes * 60_000,
    })),
  ];

  const seen = new Set<string>();
  for (const w of windows) {
    const open = wallClockToUtc(dateStr, timeOfDay(w.start_time), tz);
    const close = wallClockToUtc(dateStr, timeOfDay(w.end_time), tz);
    const step =
      w.slot_interval_minutes && w.slot_interval_minutes > 0
        ? w.slot_interval_minutes
        : DEFAULT_SLOT_INTERVAL;

    let cur = open;
    while (cur < close) {
      const slotEnd = addMinutes(cur, durationMinutes);
      if (slotEnd > close) break;

      const s = cur.getTime();
      const e = slotEnd.getTime();
      const isPast = s < nowMs;
      // 1s tolerance keeps back-to-back appointments from blocking each other.
      const overlaps = busy.some((b) => s < b.end - 1000 && e - 1000 > b.start);

      if (!isPast && !overlaps) seen.add(formatInTz(cur, tz, 'HH:mm'));
      cur = addMinutes(cur, step);
    }
  }

  // "HH:mm" is zero-padded, so lexicographic order is chronological order.
  return [...seen].sort();
}

/**
 * True when [startMs, endMs) fits entirely inside one of the day's windows.
 * A booking may not straddle the gap between two shifts, so "inside the union"
 * is deliberately not enough — it must fit in a single window.
 */
export function fitsInAnyWindow(
  windows: SlotWindow[],
  dateStr: string,
  tz: string,
  startMs: number,
  endMs: number,
): boolean {
  return windows.some((w) => {
    const open = wallClockToUtc(dateStr, timeOfDay(w.start_time), tz).getTime();
    const close = wallClockToUtc(dateStr, timeOfDay(w.end_time), tz).getTime();
    return startMs >= open && endMs <= close;
  });
}
