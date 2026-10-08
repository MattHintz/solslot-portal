/** First-party, bounded, non-blocking diagnostics. Never accepts free text or identifiers. */
export const SCREENS = ['market','property','learn','help','vault','identity','dashboard','admin_login','admin_approvals','admin_grants','admin_collection','admin_mint','admin_other','other'] as const;
export const ACTIONS = ['screen_opened','button_pressed','connect_wallet','sign_in','check_status','verify_id','retry','save_draft','seal','review_approval','submit_proposal','create_presale','api_request','wallet_prompt','asset_load'] as const;
export const STAGES = ['ui','checking_session','preparing_request','awaiting_wallet','saving_session','network_confirmation','proof','stamp','refresh'] as const;
export type JourneyScreen = typeof SCREENS[number];
export type JourneyAction = typeof ACTIONS[number];
export type JourneyStage = typeof STAGES[number];
export type JourneyPhase = 'started' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type JourneyError = 'none' | 'network' | 'unauthorized' | 'forbidden' | 'validation' | 'conflict' | 'rate_limit' | 'unavailable' | 'asset_unavailable' | 'wallet_rejected' | 'unknown';
export function journeyScreen(path: string): JourneyScreen {
  const p = path.split(/[?#]/, 1)[0].replace(/^\/genesis-admin/, '');
  if (/^\/admin\/login/.test(p)) return 'admin_login';
  if (/^\/admin\/approvals/.test(p)) return 'admin_approvals';
  if (/^\/admin\/sgt-allocations/.test(p)) return 'admin_grants';
  if (/^\/admin\/collections/.test(p)) return 'admin_collection';
  if (/^\/admin\/mint/.test(p)) return 'admin_mint';
  if (/^\/admin/.test(p)) return 'admin_other';
  if (/^\/(verify|verify-identity)/.test(p)) return 'identity';
  if (/^\/my-solslot/.test(p)) return 'dashboard';
  if (/^\/(vault-connect|protocol\/connect)/.test(p)) return 'vault';
  if (/^\/(properties|property|collections|deeds)/.test(p)) return 'property';
  if (/^\/learn/.test(p)) return 'learn';
  if (/^\/(help|contact)/.test(p)) return 'help';
  return p === '/' || /^\/market/.test(p) ? 'market' : 'other';
}
export function journeyError(status: number): JourneyError {
  return status === 0 ? 'network' : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 422 || status === 400 ? 'validation' : status === 409 ? 'conflict' : status === 429 ? 'rate_limit' : status >= 500 ? 'unavailable' : 'unknown';
}
export interface JourneyInput {
  screen: JourneyScreen; action: JourneyAction; stage?: JourneyStage; phase?: JourneyPhase;
  wallet?: 'none' | 'sage' | 'goby' | 'evm' | 'google' | 'passkey';
  request_id?: string; error_code?: JourneyError; http_status?: number; latency_ms?: number;
}
export class JourneyTransport {
  private queue: object[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private active = false;
  private attempts = 0;
  private sequence = 0;
  private flow = crypto.randomUUID();
  private disposed = false;
  get flowId(): string { return this.flow; }
  delivered = 0;
  dropped = 0;
  state: 'idle' | 'sending' | 'retrying' | 'paused' = 'idle';
  constructor(private endpoint: string, private release: string, private source: 'customer' | 'admin', private allowed: () => boolean, private sender: typeof fetch = (input, init) => fetch(input, init)) {}
  record(input: JourneyInput): void {
    if (!this.allowed() || this.disposed || !/^[0-9a-f]{40}$/.test(this.release)) return;
    if (!SCREENS.includes(input.screen) || !ACTIONS.includes(input.action)) return;
    if (++this.sequence > 200 || this.queue.length >= 80) { this.dropped++; return; }
    // Only named fields are copied. DOM text, URLs, keys and document data cannot enter the payload.
    this.queue.push({ event_id: crypto.randomUUID(), flow_id: this.flow, sequence: this.sequence,
      release_sha: this.release, diagnostics_revision: 'AE197', source: this.source, actor: typeof navigator !== 'undefined' && navigator.webdriver ? 'synthetic' : this.source === 'admin' ? 'operator' : 'visitor',
      screen: input.screen, action: input.action, stage: input.stage || 'ui', phase: input.phase || 'started',
      wallet: input.wallet || 'none', network: 'testnet11', error_code: input.error_code || 'none',
      request_id: journeyRequestId(input.request_id), http_status: input.http_status || undefined, latency_ms: input.latency_ms === undefined ? undefined : Math.min(600000, Math.max(0, Math.round(input.latency_ms))) });
    this.schedule(2000);
  }
  clear(): void { this.queue = []; this.flow = crypto.randomUUID(); this.sequence = 0; if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  dispose(): void { this.disposed = true; this.clear(); }
  private schedule(delay: number): void {
    if (this.timer || this.active || this.disposed) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
  }
  async flush(): Promise<void> {
    if (!this.allowed()) { this.clear(); return; }
    if (this.active || !this.queue.length || this.disposed) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.state = 'paused'; this.schedule(30000); return; }
    this.active = true; this.state = 'sending';
    const batch = this.queue.slice(0, 20), controller = new AbortController();
    const ids = new Set(batch.map(item => (item as {event_id: string}).event_id));
    const removeBatch = () => { this.queue = this.queue.filter(item => !ids.has((item as {event_id: string}).event_id)); };
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.sender(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'omit', keepalive: true, signal: controller.signal, body: JSON.stringify({ events: batch }) });
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500) { removeBatch(); this.dropped += batch.length; this.attempts = 0; }
        else throw new Error('intake_unavailable');
      } else { removeBatch(); this.delivered += batch.length; this.attempts = 0; }
      this.state = 'idle';
    } catch {
      this.state = 'retrying';
      if (++this.attempts >= 3) { removeBatch(); this.dropped += batch.length; this.attempts = 0; this.state = 'paused'; }
    } finally { clearTimeout(timeout); this.active = false; if (this.queue.length) this.schedule(this.attempts ? 15000 : 2000); }
  }
}

/** Accept only the server's random receipt, never an arbitrary header value. */
export function journeyRequestId(value: string | null | undefined): string | undefined {
  if (!value || !/^[0-9a-f]{32}$/.test(value)) return undefined;
  return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}
