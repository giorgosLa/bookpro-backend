import { computeDaySlots, fitsInAnyWindow, DaySlotInput } from './slots.helper';
import { wallClockToUtc } from '@/common/time/tz.util';

// Runs with TZ=UTC. Proves slot generation is correct on a UTC host: working
// hours are anchored to the clinic timezone and UTC-stored appointment instants
// correctly block the matching Athens wall-clock slot.

const TZ = 'Europe/Athens';
const DATE = '2026-06-27'; // a Saturday, summer (+3)

/** Build a working_hours time-of-day value the way Prisma stores @db.Time (1970Z). */
const tod = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);

const baseInput = (over: Partial<DaySlotInput> = {}): DaySlotInput => ({
  dateStr: DATE,
  tz: TZ,
  windows: [{ start_time: tod('09:00'), end_time: tod('12:00') }],
  blocked: [],
  appointments: [],
  durationMinutes: 30,
  bufferMinutes: 0,
  now: new Date('2020-01-01T00:00:00Z'), // far in the past → no past-slot filtering
  ...over,
});

describe('computeDaySlots', () => {
  it('generates every 30-min slot within working hours (clinic wall-clock)', () => {
    expect(computeDaySlots(baseInput())).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
    ]);
  });

  it('blocks the slot taken by a UTC-stored appointment (the core bug)', () => {
    // Patient booked 10:00 Athens → stored as 07:00Z. On a UTC host the old code
    // mismatched by 3h; the helper must still free-block exactly the 10:00 slot.
    const start = wallClockToUtc(DATE, '10:00', TZ); // 07:00Z
    const end = new Date(start.getTime() + 30 * 60_000);
    const slots = computeDaySlots(baseInput({ appointments: [{ start_time: start, end_time: end }] }));
    expect(slots).not.toContain('10:00');
    expect(slots).toContain('09:30');
    expect(slots).toContain('10:30');
  });

  it('honours blocked time stored as a date + 1970Z time-of-day', () => {
    const slots = computeDaySlots(
      baseInput({
        blocked: [
          {
            date: new Date(`${DATE}T00:00:00Z`), // date-only column → UTC midnight
            start_time: tod('11:00'),
            end_time: tod('12:00'),
          },
        ],
      }),
    );
    expect(slots).not.toContain('11:00');
    expect(slots).not.toContain('11:30');
    expect(slots).toContain('10:30');
  });

  it('skips slots already in the past relative to now (in clinic terms)', () => {
    // "Now" = 10:15 Athens on the same day → 09:00/09:30/10:00 are past.
    const now = wallClockToUtc(DATE, '10:15', TZ);
    const slots = computeDaySlots(baseInput({ now }));
    expect(slots).toEqual(['10:30', '11:00', '11:30']);
  });

  it('does not emit a slot whose end exceeds closing time', () => {
    const slots = computeDaySlots(
      baseInput({ durationMinutes: 60, windows: [{ start_time: tod('09:00'), end_time: tod('10:30') }] }),
    );
    // 09:00-10:00 ok, 09:30-10:30 ok, 10:00-11:00 exceeds → dropped.
    expect(slots).toEqual(['09:00', '09:30']);
  });

  // ── Split shifts (several windows on one weekday) ────────────────────────

  it('generates slots for a morning AND an afternoon shift, and nothing in the gap', () => {
    const slots = computeDaySlots(
      baseInput({
        windows: [
          { start_time: tod('09:00'), end_time: tod('11:00') },
          { start_time: tod('17:00'), end_time: tod('19:00') },
        ],
      }),
    );
    expect(slots).toEqual(['09:00', '09:30', '10:00', '10:30', '17:00', '17:30', '18:00', '18:30']);
    // The midday gap is genuinely closed — no slot leaks between the shifts.
    expect(slots).not.toContain('13:00');
  });

  it('honours a per-window slot interval', () => {
    const slots = computeDaySlots(
      baseInput({
        durationMinutes: 60,
        windows: [
          { start_time: tod('09:00'), end_time: tod('11:00'), slot_interval_minutes: 60 },
          { start_time: tod('17:00'), end_time: tod('19:00'), slot_interval_minutes: 30 },
        ],
      }),
    );
    // Morning steps hourly; afternoon still steps every 30 min.
    expect(slots).toEqual(['09:00', '10:00', '17:00', '17:30', '18:00']);
  });

  it('returns a deduped, chronologically sorted union when windows overlap', () => {
    const slots = computeDaySlots(
      baseInput({
        windows: [
          { start_time: tod('10:00'), end_time: tod('11:00') },
          { start_time: tod('09:00'), end_time: tod('10:30') },
        ],
      }),
    );
    expect(slots).toEqual(['09:00', '09:30', '10:00', '10:30']);
  });

  it('returns no slots when the day has no windows', () => {
    expect(computeDaySlots(baseInput({ windows: [] }))).toEqual([]);
  });

  it('blocks an afternoon-shift slot taken by an appointment', () => {
    const start = wallClockToUtc(DATE, '17:30', TZ);
    const end = new Date(start.getTime() + 30 * 60_000);
    const slots = computeDaySlots(
      baseInput({
        windows: [
          { start_time: tod('09:00'), end_time: tod('11:00') },
          { start_time: tod('17:00'), end_time: tod('19:00') },
        ],
        appointments: [{ start_time: start, end_time: end }],
      }),
    );
    expect(slots).not.toContain('17:30');
    expect(slots).toContain('17:00');
    expect(slots).toContain('18:00');
  });
});

describe('fitsInAnyWindow', () => {
  const windows = [
    { start_time: tod('09:00'), end_time: tod('11:00') },
    { start_time: tod('17:00'), end_time: tod('19:00') },
  ];
  const at = (hhmm: string) => wallClockToUtc(DATE, hhmm, TZ).getTime();

  it('accepts a booking inside the afternoon shift', () => {
    expect(fitsInAnyWindow(windows, DATE, TZ, at('17:30'), at('18:00'))).toBe(true);
  });

  it('rejects a booking in the midday gap', () => {
    expect(fitsInAnyWindow(windows, DATE, TZ, at('13:00'), at('13:30'))).toBe(false);
  });

  it('rejects a booking that straddles the gap between two shifts', () => {
    // Inside the union of the day's hours, but in neither single window.
    expect(fitsInAnyWindow(windows, DATE, TZ, at('10:30'), at('17:30'))).toBe(false);
  });

  it('accepts a booking that exactly fills a window', () => {
    expect(fitsInAnyWindow(windows, DATE, TZ, at('09:00'), at('11:00'))).toBe(true);
  });

  it('rejects when the day has no windows', () => {
    expect(fitsInAnyWindow([], DATE, TZ, at('09:00'), at('09:30'))).toBe(false);
  });
});
