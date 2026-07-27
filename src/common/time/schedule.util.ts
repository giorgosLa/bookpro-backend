import { BadRequestException, ConflictException } from '@nestjs/common';

/** The shape every schedule-writing DTO shares (availability, locations, admin). */
export interface ScheduleBlockInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isEnabled: boolean;
  slotIntervalMinutes?: number | null;
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const DAY_NAMES = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];

/**
 * A weekday may hold several windows, so the write paths have to reject the two
 * ways a caller can produce an incoherent day: a window that ends before it
 * starts, and two windows on the same day that overlap (which would otherwise
 * silently produce duplicate slots).
 *
 * Only enabled blocks are checked — a disabled day carries no windows.
 */
export function assertValidScheduleBlocks(blocks: ScheduleBlockInput[]): void {
  const byDay = new Map<number, ScheduleBlockInput[]>();

  for (const b of blocks) {
    if (!b.isEnabled) continue;
    if (toMinutes(b.endTime) <= toMinutes(b.startTime)) {
      throw new BadRequestException(
        `${DAY_NAMES[b.dayOfWeek]}: η ώρα λήξης (${b.endTime}) πρέπει να είναι μετά την ώρα έναρξης (${b.startTime})`,
      );
    }
    const arr = byDay.get(b.dayOfWeek) ?? [];
    arr.push(b);
    byDay.set(b.dayOfWeek, arr);
  }

  for (const [day, dayBlocks] of byDay) {
    const sorted = [...dayBlocks].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
    for (let i = 1; i < sorted.length; i++) {
      if (toMinutes(sorted[i].startTime) < toMinutes(sorted[i - 1].endTime)) {
        throw new BadRequestException(
          `${DAY_NAMES[day]}: τα ωράρια ${sorted[i - 1].startTime}–${sorted[i - 1].endTime} και ` +
            `${sorted[i].startTime}–${sorted[i].endTime} επικαλύπτονται`,
        );
      }
    }
  }
}

/** Wall-clock "HH:mm" of a @db.Time value (Prisma stores these as 1970-01-01T<HH:mm>:00Z). */
export function timeColumnToHM(t: Date): string {
  return t.toISOString().substring(11, 16);
}

/**
 * Guards a blocked-time range against the two ways it can be incoherent.
 *
 * SEVERAL blocks per date are allowed on purpose: a split-shift day often needs
 * one break per shift (e.g. 11:00–12:00 in the morning and 18:00–19:00 in the
 * evening). Overlapping ones are still rejected — they are indistinguishable
 * from a single wider block and only make the list confusing.
 */
export function assertBlockedRangeFree(
  existing: { start_time: Date; end_time: Date }[],
  startTime: string,
  endTime: string,
): void {
  if (endTime <= startTime) {
    throw new BadRequestException('End time must be after start time');
  }
  // "HH:mm" is zero-padded, so string comparison is chronological comparison.
  const clash = existing.find(
    (b) => startTime < timeColumnToHM(b.end_time) && timeColumnToHM(b.start_time) < endTime,
  );
  if (clash) {
    throw new ConflictException(
      `Το διάστημα επικαλύπτεται με υπάρχον μπλοκάρισμα ` +
        `${timeColumnToHM(clash.start_time)}–${timeColumnToHM(clash.end_time)}`,
    );
  }
}

/** Maps a validated DTO block to the working_hours column shape. */
export function toWorkingHourRow(b: ScheduleBlockInput, index: number) {
  return {
    day_of_week: b.dayOfWeek,
    start_time: new Date(`1970-01-01T${b.startTime}:00Z`),
    end_time: new Date(`1970-01-01T${b.endTime}:00Z`),
    is_enabled: b.isEnabled,
    slot_interval_minutes: b.slotIntervalMinutes ?? null,
    order: index,
  };
}
