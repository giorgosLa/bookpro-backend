import { addMinutes } from 'date-fns';
import { wallClockToUtc, formatInTz } from '@/common/time/tz.util';

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

export interface DaySlotInput {
  /** Calendar date being computed, "yyyy-MM-dd", in the clinic timezone. */
  dateStr: string;
  /** Clinic IANA timezone, e.g. "Europe/Athens" / "Asia/Nicosia". */
  tz: string;
  /** Working hours row for this weekday (time-of-day columns). */
  wh: { start_time: Date; end_time: Date };
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
 */
export function computeDaySlots(input: DaySlotInput): string[] {
  const {
    dateStr,
    tz,
    wh,
    blocked,
    appointments,
    durationMinutes,
    bufferMinutes = 0,
  } = input;
  const nowMs = (input.now ?? new Date()).getTime();

  const open = wallClockToUtc(dateStr, timeOfDay(wh.start_time), tz);
  const close = wallClockToUtc(dateStr, timeOfDay(wh.end_time), tz);

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

  const slots: string[] = [];
  let cur = open;
  while (cur < close) {
    const slotEnd = addMinutes(cur, durationMinutes);
    if (slotEnd > close) break;

    const s = cur.getTime();
    const e = slotEnd.getTime();
    const isPast = s < nowMs;
    // 1s tolerance keeps back-to-back appointments from blocking each other.
    const overlaps = busy.some((b) => s < b.end - 1000 && e - 1000 > b.start);

    if (!isPast && !overlaps) {
      slots.push(formatInTz(cur, tz, 'HH:mm'));
    }
    cur = addMinutes(cur, 30);
  }
  return slots;
}
