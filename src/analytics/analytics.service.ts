import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { subDays, format } from 'date-fns';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Aggregates analytics for a doctor's dashboard:
   * - totalRevenue: sum of prices for completed appointments
   * - completionRate: % of appointments that reached "completed" status
   * - uniqueClients: distinct client emails across confirmed/completed appointments
   * - dailyStats: bookings and revenue per day for the last 30 days
   * - serviceDistribution: booking count grouped by service name
   */
  async getData(userId: string) {
    const appointments = await this.prisma.appointments.findMany({
      where: { profile_id: userId },
      include: { services: true },
      orderBy: { start_time: 'asc' },
    });

    const completed = appointments.filter((a) => a.status === 'completed');
    const active = appointments.filter((a) => ['confirmed', 'completed'].includes(a.status));

    const totalRevenue = completed.reduce(
      (sum, a) => sum + Number(a.services?.price ?? 0),
      0,
    );

    const completionRate =
      appointments.length > 0
        ? Math.round((completed.length / appointments.length) * 100)
        : 0;

    const uniqueClients = new Set(active.map((a) => a.client_email)).size;

    const last30Days = Array.from({ length: 30 }, (_, i) => {
      const date = format(subDays(new Date(), 29 - i), 'yyyy-MM-dd');
      const dayAppts = appointments.filter(
        (a) => format(new Date(a.start_time), 'yyyy-MM-dd') === date,
      );
      return {
        date,
        bookings: dayAppts.length,
        revenue: dayAppts
          .filter((a) => a.status === 'completed')
          .reduce((s, a) => s + Number(a.services?.price ?? 0), 0),
      };
    });

    const serviceMap = new Map<string, number>();
    appointments.forEach((a) => {
      const name = a.services?.name ?? 'Unknown';
      serviceMap.set(name, (serviceMap.get(name) ?? 0) + 1);
    });
    const serviceDistribution = Array.from(serviceMap.entries()).map(([name, count]) => ({
      name,
      count,
    }));

    return {
      totalRevenue,
      totalBookings: appointments.length,
      completionRate,
      uniqueClients,
      dailyStats: last30Days,
      serviceDistribution,
    };
  }
}
