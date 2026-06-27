import { computeDaySlots, DaySlotInput } from './slots.helper';
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
  wh: { start_time: tod('09:00'), end_time: tod('12:00') },
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
    const slots = computeDaySlots(baseInput({ durationMinutes: 60, wh: { start_time: tod('09:00'), end_time: tod('10:30') } }));
    // 09:00-10:00 ok, 09:30-10:30 ok, 10:00-11:00 exceeds → dropped.
    expect(slots).toEqual(['09:00', '09:30']);
  });
});
