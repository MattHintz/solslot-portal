import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { AdminStatusRefresh } from './admin-status-refresh.service';

describe('Read-only administrator refresh', () => {
  let cleanup: () => void;
  let page: EventTarget & { visibilityState: string; defaultView: any };
  let refresh: AdminStatusRefresh;

  beforeEach(() => {
    cleanup = () => TestBed.resetTestingModule();
    const view = Object.assign(new EventTarget(), { navigator: { onLine: true } });
    page = Object.assign(new EventTarget(), { visibilityState: 'visible', defaultView: view });
    TestBed.configureTestingModule({ providers: [AdminStatusRefresh,
      { provide: DOCUMENT, useValue: page },
    ] });
    refresh = TestBed.inject(AdminStatusRefresh);
  });

  it('refreshes immediately and every 15 seconds without overlapping a slow read', fakeAsync(() => {
    let release!: () => void;
    const read = jasmine.createSpy('status GET').and.callFake(() => new Promise<void>(resolve => release = resolve));
    refresh.start(read);
    void refresh.refresh();
    tick(30_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(refresh.refreshing()).toBeTrue();
    release(); flushMicrotasks();
    expect(refresh.lastUpdated()).not.toBeNull();
    tick(14_999); expect(read).toHaveBeenCalledTimes(1);
    tick(1); expect(read).toHaveBeenCalledTimes(2);
    cleanup(); release(); flushMicrotasks();
  }));

  it('waits while a wallet review is open, then resumes status reads', fakeAsync(() => {
    const walletOpen = signal(true);
    const read = jasmine.createSpy('status GET').and.resolveTo();
    refresh.start(read, () => walletOpen() ? 'Waiting for wallet' : null);
    tick(15_000); expect(read).not.toHaveBeenCalled();
    expect(refresh.pausedReason()).toContain('wallet');
    walletOpen.set(false); tick(5000);
    expect(read).toHaveBeenCalledTimes(1);
    cleanup();
  }));

  it('pauses hidden and offline tabs, and refreshes on return and reconnection', fakeAsync(() => {
    const read = jasmine.createSpy('status GET').and.resolveTo();
    page.visibilityState = 'hidden';
    refresh.visible.set(false);
    refresh.start(read); tick(30_000);
    expect(read).not.toHaveBeenCalled();
    page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange')); flushMicrotasks();
    expect(read).toHaveBeenCalledTimes(1);
    page.defaultView.navigator.onLine = false;
    page.defaultView.dispatchEvent(new Event('offline')); tick(30_000);
    expect(read).toHaveBeenCalledTimes(1);
    page.defaultView.navigator.onLine = true;
    page.defaultView.dispatchEvent(new Event('online')); flushMicrotasks();
    expect(read).toHaveBeenCalledTimes(2);
    cleanup();
  }));

  it('retains the last successful check and backs off read failures to 60 seconds', fakeAsync(() => {
    const read = jasmine.createSpy('status GET').and.resolveTo();
    refresh.start(read); flushMicrotasks();
    const previous = refresh.lastUpdated();
    read.and.rejectWith(new Error('service unavailable'));
    tick(15_000); expect(read).toHaveBeenCalledTimes(2);
    expect(refresh.lastUpdated()).toBe(previous);
    expect(refresh.error()).toContain('retrying automatically');
    tick(29_999); expect(read).toHaveBeenCalledTimes(2);
    tick(1); expect(read).toHaveBeenCalledTimes(3);
    tick(60_000); expect(read).toHaveBeenCalledTimes(4);
    read.and.resolveTo(); tick(60_000);
    expect(refresh.error()).toBeNull();
    tick(15_000); expect(read).toHaveBeenCalledTimes(6);
    cleanup();
  }));

  it('removes timers and event handlers when the page is destroyed', fakeAsync(() => {
    const read = jasmine.createSpy('status GET').and.resolveTo();
    refresh.start(read); flushMicrotasks(); cleanup();
    page.defaultView.dispatchEvent(new Event('focus'));
    tick(120_000);
    expect(read).toHaveBeenCalledTimes(1);
  }));
});
