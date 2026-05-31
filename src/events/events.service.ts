import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

@Injectable()
export class EventsService {
  // One Subject per doctor userId. Created on first SSE connection, removed on last disconnect.
  private readonly streams = new Map<string, Subject<any>>();

  getStream(userId: string): Observable<any> {
    if (!this.streams.has(userId)) {
      this.streams.set(userId, new Subject());
    }
    return this.streams.get(userId)!.asObservable();
  }

  /** Called by PublicService after a booking is created. No-op if doctor is not connected. */
  emit(userId: string, data: any): void {
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
