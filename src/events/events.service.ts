import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Subject, Observable } from 'rxjs';

/**
 * Real-time SSE event hub.
 *
 * Each instance keeps its own in-memory Subjects (one per connected doctor) —
 * the SSE controller subscribes to these locally. To make notifications work
 * across multiple API instances behind a load balancer, `emit()` publishes to
 * a shared Redis channel instead of writing directly to the local Map. Every
 * instance subscribes to that channel and routes incoming messages to its own
 * local Subjects, so a booking can be handled on instance B while the doctor's
 * SSE connection lives on instance A.
 *
 * If REDIS_URL is not configured (local dev / single instance) it degrades
 * gracefully to pure in-process delivery.
 */
@Injectable()
export class EventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsService.name);
  private static readonly CHANNEL = 'bookpro:sse';

  // One Subject per doctor userId. Created on first SSE connection, removed on last disconnect.
  private readonly streams = new Map<string, Subject<any>>();

  // Two connections: Redis requires a dedicated client for subscribe mode.
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.config.get<string>('redis.url');
    if (!url) {
      this.logger.warn(
        'REDIS_URL not set — SSE events are delivered in-process only (do not run multiple instances).',
      );
      return;
    }

    this.publisher = new Redis(url, { maxRetriesPerRequest: null });
    this.subscriber = new Redis(url, { maxRetriesPerRequest: null });

    this.publisher.on('error', (e) =>
      this.logger.error(`Redis publisher error: ${e.message}`),
    );
    this.subscriber.on('error', (e) =>
      this.logger.error(`Redis subscriber error: ${e.message}`),
    );

    this.subscriber.subscribe(EventsService.CHANNEL, (err) => {
      if (err) {
        this.logger.error(
          `Failed to subscribe to Redis channel: ${err.message}`,
        );
      } else {
        this.logger.log('Subscribed to Redis SSE channel');
      }
    });

    this.subscriber.on('message', (_channel, payload) => {
      try {
        const { userId, data } = JSON.parse(payload);
        this.route(userId, data);
      } catch (e) {
        this.logger.error(`Bad SSE payload from Redis: ${(e as Error).message}`);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.publisher?.quit(), this.subscriber?.quit()]);
  }

  getStream(userId: string): Observable<any> {
    if (!this.streams.has(userId)) {
      this.streams.set(userId, new Subject());
    }
    return this.streams.get(userId)!.asObservable();
  }

  /**
   * Notify a doctor of an event. Fire-and-forget.
   *
   * With Redis configured this publishes to the shared channel; the message is
   * delivered back to every instance (including this one) and routed to local
   * SSE streams there. Without Redis it routes directly to the local Map.
   */
  emit(userId: string, data: any): void {
    if (this.publisher) {
      this.publisher
        .publish(EventsService.CHANNEL, JSON.stringify({ userId, data }))
        .catch((e) =>
          this.logger.error(`Failed to publish SSE event: ${e.message}`),
        );
    } else {
      this.route(userId, data);
    }
  }

  /** Deliver to a locally-connected doctor, if any. No-op otherwise. */
  private route(userId: string, data: any): void {
    this.streams.get(userId)?.next(data);
  }

  /** Remove Subject from map once no more subscribers remain (called on disconnect). */
  cleanup(userId: string): void {
    const subject = this.streams.get(userId);
    if (subject && !subject.observed) {
      this.streams.delete(userId);
    }
  }
}
