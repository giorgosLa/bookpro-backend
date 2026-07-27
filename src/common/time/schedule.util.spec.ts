import { assertBlockedRangeFree, assertValidScheduleBlocks, ScheduleBlockInput } from './schedule.util';

/** Build a @db.Time value the way Prisma stores it (1970-01-01T<HH:mm>:00Z). */
const tod = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);
const range = (start: string, end: string) => ({ start_time: tod(start), end_time: tod(end) });

const block = (over: Partial<ScheduleBlockInput> = {}): ScheduleBlockInput => ({
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '13:00',
  isEnabled: true,
  ...over,
});

describe('assertValidScheduleBlocks', () => {
  it('accepts a split shift on one day', () => {
    expect(() =>
      assertValidScheduleBlocks([
        block({ startTime: '09:00', endTime: '13:00' }),
        block({ startTime: '17:00', endTime: '21:00' }),
      ]),
    ).not.toThrow();
  });

  it('accepts two windows that merely touch', () => {
    expect(() =>
      assertValidScheduleBlocks([
        block({ startTime: '09:00', endTime: '13:00' }),
        block({ startTime: '13:00', endTime: '17:00' }),
      ]),
    ).not.toThrow();
  });

  it('rejects overlapping windows on the same day', () => {
    expect(() =>
      assertValidScheduleBlocks([
        block({ startTime: '09:00', endTime: '14:00' }),
        block({ startTime: '13:00', endTime: '17:00' }),
      ]),
    ).toThrow(/επικαλύπτονται/);
  });

  it('allows the same hours on different days', () => {
    expect(() =>
      assertValidScheduleBlocks([block({ dayOfWeek: 1 }), block({ dayOfWeek: 2 })]),
    ).not.toThrow();
  });

  it('rejects an inverted window', () => {
    expect(() => assertValidScheduleBlocks([block({ startTime: '17:00', endTime: '09:00' })])).toThrow(
      /μετά την ώρα έναρξης/,
    );
  });

  it('ignores disabled days entirely', () => {
    expect(() =>
      assertValidScheduleBlocks([
        block({ isEnabled: false, startTime: '17:00', endTime: '09:00' }),
        block({ isEnabled: false, startTime: '09:00', endTime: '14:00' }),
        block({ isEnabled: false, startTime: '13:00', endTime: '17:00' }),
      ]),
    ).not.toThrow();
  });
});

describe('assertBlockedRangeFree', () => {
  it('allows a second break on a day that already has one', () => {
    // The split-shift case: a morning break and an evening break on the same date.
    expect(() => assertBlockedRangeFree([range('11:00', '12:00')], '18:00', '19:00')).not.toThrow();
  });

  it('allows a block that starts exactly when another ends', () => {
    expect(() => assertBlockedRangeFree([range('11:00', '12:00')], '12:00', '13:00')).not.toThrow();
  });

  it('rejects a partially overlapping block', () => {
    expect(() => assertBlockedRangeFree([range('11:00', '13:00')], '12:00', '14:00')).toThrow(/επικαλύπτεται/);
  });

  it('rejects a block fully inside an existing one', () => {
    expect(() => assertBlockedRangeFree([range('09:00', '17:00')], '12:00', '13:00')).toThrow(/επικαλύπτεται/);
  });

  it('rejects a block that fully contains an existing one', () => {
    expect(() => assertBlockedRangeFree([range('12:00', '13:00')], '09:00', '17:00')).toThrow(/επικαλύπτεται/);
  });

  it('names the conflicting block in the message', () => {
    expect(() => assertBlockedRangeFree([range('11:00', '13:00')], '12:00', '14:00')).toThrow(/11:00–13:00/);
  });

  it('rejects an inverted range', () => {
    expect(() => assertBlockedRangeFree([], '14:00', '12:00')).toThrow(/End time must be after start time/);
  });

  it('accepts any range when the date has no blocks yet', () => {
    expect(() => assertBlockedRangeFree([], '09:00', '17:00')).not.toThrow();
  });
});
