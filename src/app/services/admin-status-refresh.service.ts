import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, NgZone, computed, inject, signal } from '@angular/core';

/** A page-scoped, read-only refresh loop. Wallet and transaction actions stay explicit. */
@Injectable()
export class AdminStatusRefresh {
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly destroy = inject(DestroyRef);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private failures = 0;
  private read: () => Promise<void> = async () => {};
  private blocked: () => string | null = () => null;

  readonly refreshing = signal(false);
  readonly lastUpdated = signal<number | null>(null);
  readonly error = signal<string | null>(null);
  readonly now = signal(Date.now());
  readonly visible = signal(this.document.visibilityState !== 'hidden');
  readonly online = signal(this.document.defaultView?.navigator.onLine !== false);
  readonly pausedReason = computed(() => {
    this.now(); // Also reevaluate expiring sessions and review windows.
    if (!this.online()) return 'Offline. Updates resume when you reconnect.';
    if (!this.visible()) return 'Updates paused while this tab is hidden.';
    return this.blocked();
  });

  constructor() {
    const resume = () => {
      this.visible.set(this.document.visibilityState !== 'hidden');
      this.online.set(this.document.defaultView?.navigator.onLine !== false);
      if (!this.pausedReason()) void this.refresh();
    };
    this.document.addEventListener('visibilitychange', resume);
    this.document.defaultView?.addEventListener('online', resume);
    this.document.defaultView?.addEventListener('offline', resume);
    this.document.defaultView?.addEventListener('focus', resume);
    this.destroy.onDestroy(() => {
      this.disposed = true;
      if (this.timer) clearTimeout(this.timer);
      if (this.clock) clearInterval(this.clock);
      this.document.removeEventListener('visibilitychange', resume);
      this.document.defaultView?.removeEventListener('online', resume);
      this.document.defaultView?.removeEventListener('offline', resume);
      this.document.defaultView?.removeEventListener('focus', resume);
    });
  }

  start(read: () => Promise<void>, blocked: () => string | null = () => null): void {
    this.read = read;
    this.blocked = blocked;
    if (!this.clock) this.zone.runOutsideAngular(() => {
      this.clock = setInterval(() => this.now.set(Date.now()), 1000);
    });
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.disposed || this.refreshing()) return;
    if (this.timer) clearTimeout(this.timer);
    if (this.pausedReason()) { this.schedule(5000); return; }
    this.refreshing.set(true);
    try {
      await this.read();
      if (this.disposed) return;
      this.lastUpdated.set(Date.now());
      this.error.set(null);
      this.failures = 0;
    } catch {
      if (!this.disposed) {
        this.failures += 1;
        this.error.set('Could not update. Previous results are still shown; retrying automatically.');
      }
    } finally {
      this.refreshing.set(false);
      this.schedule(Math.min(60_000, 15_000 * 2 ** this.failures));
    }
  }

  /** Used after an explicit action or initial load, without starting another request. */
  updated(): void {
    this.lastUpdated.set(Date.now());
    this.error.set(null);
  }

  private schedule(delay: number): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.zone.runOutsideAngular(() => {
      this.timer = setTimeout(() => void this.refresh(), delay);
    });
  }
}
