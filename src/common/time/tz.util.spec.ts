import {
  wallClockToUtc,
  formatInTz,
  resolveTimezone,
  CLINIC_DEFAULT_TZ,
} from './tz.util';

// These tests run with TZ=UTC (see package.json "test" script). That is the
// whole point: they prove the conversions are correct on a UTC host — exactly
// the production scenario where the old server-local code produced wrong times.

describe('wallClockToUtc', () => {
  it('interprets Athens summer wall-clock (+3) as the right UTC instant', () => {
    // 10:00 in Athens during DST = 07:00 UTC.
    expect(wallClockToUtc('2026-06-27', '10:00', 'Europe/Athens').toISOString()).toBe(
      '2026-06-27T07:00:00.000Z',
    );
  });

  it('interprets Athens winter wall-clock (+2) as the right UTC instant', () => {
    // 10:00 in Athens in January (no DST) = 08:00 UTC.
    expect(wallClockToUtc('2026-01-15', '10:00', 'Europe/Athens').toISOString()).toBe(
      '2026-01-15T08:00:00.000Z',
    );
  });

  it('treats Nicosia the same as Athens (same offset today)', () => {
    expect(wallClockToUtc('2026-06-27', '10:00', 'Asia/Nicosia').toISOString()).toBe(
      '2026-06-27T07:00:00.000Z',
    );
  });

  it('accepts HH:mm:ss as well as HH:mm', () => {
    expect(wallClockToUtc('2026-06-27', '10:00:00', 'Europe/Athens').toISOString()).toBe(
      '2026-06-27T07:00:00.000Z',
    );
  });
});

describe('formatInTz', () => {
  it('renders a UTC instant as the clinic wall-clock', () => {
    const instant = new Date('2026-06-27T07:00:00.000Z');
    expect(formatInTz(instant, 'Europe/Athens', 'HH:mm')).toBe('10:00');
  });

  it('round-trips with wallClockToUtc', () => {
    const tz = 'Europe/Athens';
    const instant = wallClockToUtc('2026-06-27', '14:30', tz);
    expect(formatInTz(instant, tz, 'yyyy-MM-dd HH:mm')).toBe('2026-06-27 14:30');
  });
});

describe('resolveTimezone', () => {
  it('prefers the location timezone', () => {
    expect(resolveTimezone('Europe/Athens', 'Asia/Nicosia')).toBe('Asia/Nicosia');
  });

  it('falls back to the doctor timezone', () => {
    expect(resolveTimezone('Asia/Nicosia', null)).toBe('Asia/Nicosia');
  });

  it('falls back to the platform default when nothing is set', () => {
    expect(resolveTimezone(null, null)).toBe(CLINIC_DEFAULT_TZ);
  });
});
