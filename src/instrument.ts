import 'dotenv/config'; // load .env before reading SENTRY_DSN (runs before ConfigModule)
import * as Sentry from '@sentry/nestjs';

// Pin the process timezone to the clinic's timezone. The slot-generation and
// booking code interprets every wall-clock time (e.g. "10:00") in the server's
// LOCAL timezone, so the server must run in Greece time — otherwise a 10:00
// booking on a UTC production host is stored 3h off and shows as 13:00.
// Set before any Date is constructed. Override with the TZ env var if needed.
process.env.TZ = process.env.TZ || 'Europe/Athens';

// Must be imported at the very top of main.ts, before any other module.
// Only initializes when SENTRY_DSN is set, so local dev without a DSN is a no-op.
if (process.env.SENTRY_DSN) {
  const isProd = process.env.NODE_ENV === 'production';
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',

    // Performance tracing: captures every endpoint as a transaction and every
    // pg query as a span (the pg pool is auto-instrumented). Full sampling in
    // dev for visibility; 10% in production to stay within quota.
    // Override with SENTRY_TRACES_SAMPLE_RATE if you need to tune it live.
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : isProd
        ? 0.1
        : 1.0,

    sendDefaultPii: false,
  });
  console.log('[Sentry] initialized ✓');
} else {
  console.log('[Sentry] SENTRY_DSN not set — disabled');
}
