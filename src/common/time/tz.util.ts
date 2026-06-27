import { fromZonedTime, toZonedTime, formatInTimeZone } from 'date-fns-tz';

/**
 * Timezone utilities — the single source of truth for converting between
 * wall-clock times (what a patient/doctor sees, e.g. "10:00") and absolute UTC
 * instants (what we store in `appointments.start_time`).
 *
 * The golden rule of this codebase: appointment instants are stored in UTC, and
 * every conversion to/from a human-readable wall-clock goes through a clinic
 * timezone — NEVER through the server's local timezone. This makes correctness
 * independent of where the process runs (UTC in prod, Athens on a dev laptop).
 */

/** Fallback when neither the location nor the doctor has a timezone set. */
export const CLINIC_DEFAULT_TZ =
  process.env.CLINIC_DEFAULT_TZ || 'Europe/Athens';

/**
 * Resolve the effective timezone for an appointment/slot.
 * A location is physically somewhere, so its timezone wins; otherwise fall back
 * to the doctor's profile timezone, then the platform default.
 */
export function resolveTimezone(
  doctorTz?: string | null,
  locationTz?: string | null,
): string {
  return locationTz || doctorTz || CLINIC_DEFAULT_TZ;
}

/**
 * Interpret a wall-clock date + time in the given timezone and return the
 * absolute UTC instant. e.g. ("2026-06-27", "10:00", "Europe/Athens") in summer
 * → 2026-06-27T07:00:00Z.
 */
export function wallClockToUtc(
  dateStr: string,
  timeStr: string,
  tz: string,
): Date {
  // timeStr may be "HH:mm" or "HH:mm:ss" — normalise to seconds.
  const time = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  return fromZonedTime(`${dateStr}T${time}`, tz);
}

/** Format an absolute instant as it reads on the clock in the given timezone. */
export function formatInTz(
  instant: Date,
  tz: string,
  fmt: string,
  opts?: { locale?: Locale },
): string {
  return formatInTimeZone(instant, tz, fmt, opts);
}

/** "Now" expressed as a zoned Date whose local fields read as the tz wall-clock. */
export function nowInTz(tz: string): Date {
  return toZonedTime(new Date(), tz);
}

/** The current calendar date (yyyy-MM-dd) in the given timezone. */
export function todayStrInTz(tz: string): string {
  return formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
}

/** The yyyy-MM-dd calendar date an instant falls on in the given timezone. */
export function dateStrInTz(instant: Date, tz: string): string {
  return formatInTimeZone(instant, tz, 'yyyy-MM-dd');
}

/** Day of week (0=Sun..6=Sat) an instant falls on in the given timezone. */
export function dayOfWeekInTz(instant: Date, tz: string): number {
  return toZonedTime(instant, tz).getDay();
}

// date-fns Locale type without importing the whole package surface here.
type Locale = import('date-fns').Locale;
