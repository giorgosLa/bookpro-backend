import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { subDays, startOfDay, format } from 'date-fns';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Aggregates analytics for a doctor's dashboard.
   * Uses parallel targeted queries instead of a full table scan:
   * - counts via COUNT (no data transfer)
   * - revenue via small projection on completed only
   * - unique clients via DISTINCT
   * - daily stats via date-filtered fetch (last 30 days only)
   * - service distribution via GROUP BY
   */
  async getData(userId: string) {
    const thirtyDaysAgo = startOfDay(subDays(new Date(), 29));

    const [
      totalBookings,
      completedCount,
      revenueRows,
      uniqueRows,
      recentAppointments,
      serviceGroups,
      serviceNames,
    ] = await Promise.all([
      this.prisma.appointments.count({
        where: { profile_id: userId },
      }),
      this.prisma.appointments.count({
        where: { profile_id: userId, status: 'completed' },
      }),
      this.prisma.$queryRaw<[{ total: number }]>`
        SELECT COALESCE(SUM(s.price), 0)::float8 AS total
        FROM appointments a
        JOIN services s ON a.service_id = s.id
        WHERE a.profile_id = ${userId}::uuid AND a.status = 'completed'
      `,
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT client_email) AS count
        FROM appointments
        WHERE profile_id = ${userId}::uuid
          AND status IN ('confirmed', 'completed')
      `,
      this.prisma.appointments.findMany({
        where: { profile_id: userId, start_time: { gte: thirtyDaysAgo } },
        select: { start_time: true, status: true, services: { select: { price: true } } },
        orderBy: { start_time: 'asc' },
      }),
      this.prisma.appointments.groupBy({
        by: ['service_id'],
        where: { profile_id: userId },
        _count: { id: true },
      }),
      this.prisma.services.findMany({
        where: { profile_id: userId },
        select: { id: true, name: true },
      }),
    ]);

    const totalRevenue = revenueRows[0]?.total ?? 0;

    const completionRate =
      totalBookings > 0 ? Math.round((completedCount / totalBookings) * 100) : 0;

    // Build daily buckets in a single O(n) pass
    const dailyMap = new Map<string, { bookings: number; revenue: number }>();
    for (const a of recentAppointments) {
      const date = a.start_time.toISOString().substring(0, 10);
      if (!dailyMap.has(date)) dailyMap.set(date, { bookings: 0, revenue: 0 });
      const entry = dailyMap.get(date)!;
      entry.bookings++;
      if (a.status === 'completed') entry.revenue += Number(a.services?.price ?? 0);
    }
    const last30Days = Array.from({ length: 30 }, (_, i) => {
      const date = format(subDays(new Date(), 29 - i), 'yyyy-MM-dd');
      return { date, ...(dailyMap.get(date) ?? { bookings: 0, revenue: 0 }) };
    });

    const serviceNameMap = new Map(serviceNames.map((s) => [s.id, s.name]));
    const serviceDistribution = serviceGroups.map((g) => ({
      name: serviceNameMap.get(g.service_id) ?? 'Unknown',
      count: g._count.id,
    }));

    return {
      totalRevenue,
      totalBookings,
      completionRate,
      uniqueClients: Number(uniqueRows[0]?.count ?? 0),
      dailyStats: last30Days,
      serviceDistribution,
    };
  }
}
