import { Injectable, inject, DestroyRef, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../environments/environment';
import { JourneyInput, JourneyTransport, journeyScreen, ACTIONS, JourneyAction } from './journey-transport';

@Injectable({providedIn: 'root'})
export class JourneyTelemetryService {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  
  private readonly destroy = inject(DestroyRef);
  readonly transport = new JourneyTransport(environment.faucetApi.replace(/\/$/, '') + '/alpha/journey-events',
    environment.solslotProtocol.adminPortalSourceSha, 'admin', () => this.browser && true);
  readonly updateNeeded = signal(false);
  get flowId(): string | undefined { return this.browser ? this.transport.flowId : undefined; }
  private installed = false;
  record(input: Omit<JourneyInput, 'screen'> & {screen?: JourneyInput['screen']}): void {
    if (!this.browser) return;
    this.transport.record({ ...input, screen: input.screen || journeyScreen(location.pathname) });
  }
  noteAssetFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : '';
    if (!/dynamically imported module|ChunkLoadError|Loading chunk/i.test(message)) return;
    this.updateNeeded.set(true);
    this.record({action: 'asset_load', phase: 'failed', error_code: 'asset_unavailable'});
  }
  initialize(): void {
    if (!this.browser || this.installed) return;
    this.installed = true;
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest('button, a[data-ux-action]');
      if (!control || (control instanceof HTMLButtonElement && control.disabled)) return;
      const value = control.getAttribute('data-ux-action') as JourneyAction;
      this.record({action: ACTIONS.includes(value) ? value : 'button_pressed'});
    };
    const error = (event: ErrorEvent | PromiseRejectionEvent) => {
      const reason = 'reason' in event ? event.reason : event.error;
      // Inspect only to classify; never record the actual message, stack or URL.
      const chunk = /dynamically imported module|ChunkLoadError|Loading chunk/i.test(String(reason?.message || ''));
      if (chunk) this.updateNeeded.set(true);
      this.record({action: 'asset_load', phase: 'failed', error_code: chunk ? 'asset_unavailable' : 'unknown'});
    };
    const flush = () => { void this.transport.flush(); };
    document.addEventListener('click', click, {capture: true, passive: true});
    window.addEventListener('error', error);
    window.addEventListener('unhandledrejection', error);
    window.addEventListener('pagehide', flush);
    this.destroy.onDestroy(() => {
      document.removeEventListener('click', click, true);
      window.removeEventListener('error', error); window.removeEventListener('unhandledrejection', error);
      window.removeEventListener('pagehide', flush); this.transport.dispose();
    });
    this.record({action: 'screen_opened'});
  }
}
