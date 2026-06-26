// In-memory caches for the public read-heavy endpoints, plus invalidation on doctor writes.
// Kept dependency-free on purpose: mutation services (users, services, locations, availability)
// import invalidateDoctorCaches from here without pulling in PublicService — no circular imports.

type Cached<T> = { data: T; expiresAt: number };

/** Availability dates per `${profileId}:${limit}:${locationId}` — see getAvailabilityDates. */
export const availCache = new Map<string, Cached<{ date: string; firstSlot: string }[]>>();
export const AVAIL_TTL = 30 * 1000; // 30 seconds

/** Doctor listing per `${specialty}:${location}` — see getDoctors. Typed loosely; cast at read site. */
export const doctorsCache = new Map<string, Cached<unknown>>();
export const DOCTORS_TTL = 60 * 1000; // 60 seconds

/** Public profile per slug — see getProfile. Typed loosely; cast at read site. */
export const profileCache = new Map<string, Cached<unknown>>();
export const PROFILE_TTL = 60 * 1000; // 60 seconds

/**
 * Clears every public cache affected by a doctor editing their own data
 * (services, locations, working hours, profile fields, photos, avatar).
 * Call after any such write so the public pages reflect the change immediately
 * instead of waiting for the TTL to expire.
 */
export function invalidateDoctorCaches(userId?: string) {
  // availCache is keyed by `${profileId}:...` — drop just this doctor's entries.
  // (Omit userId for bulk operations where only doctors/profile caches matter.)
  if (userId) {
    for (const key of availCache.keys()) {
      if (key.startsWith(`${userId}:`)) availCache.delete(key);
    }
  }
  // doctorsCache (by specialty+location) and profileCache (by slug) can't be cheaply
  // narrowed to one doctor — clear fully. They rebuild in one query on next read and
  // doctor writes are infrequent, so the cost is negligible.
  doctorsCache.clear();
  profileCache.clear();
}
