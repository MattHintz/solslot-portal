import { sendJourneyBatch } from './journey-transport';

describe('Journey browser security boundary', () => {
  const token = 'v1.1791470000.' + 'a'.repeat(64) + '.' + 'b'.repeat(64);
  const fresh = 'v1.1791470001.' + 'c'.repeat(64) + '.' + 'd'.repeat(64);
  const endpoint = '/protocol-api/alpha/journey-events';
  const body = JSON.stringify({events: [{action: 'screen_opened'}]});
  let fetchSpy: jasmine.Spy;
  const setToken = (value: string) => document.cookie = 'XSRF-TOKEN=' + value + '; Path=/; SameSite=Strict';
  beforeEach(() => { fetchSpy = spyOn(window, 'fetch'); document.cookie = 'XSRF-TOKEN=; Path=/; Max-Age=0'; });
  afterEach(() => { document.cookie = 'XSRF-TOKEN=; Path=/; Max-Age=0'; });
  it('echoes the existing security token with same-origin credentials and no payload expansion', async () => {
    setToken(token); fetchSpy.and.resolveTo(new Response('{}', {status: 202}));
    await sendJourneyBatch(endpoint, {method: 'POST', body, headers: {'Content-Type': 'application/json'}});
    const [url, init] = fetchSpy.calls.mostRecent().args;
    expect(url).toBe(location.origin + endpoint);
    expect(init.credentials).toBe('same-origin'); expect(init.redirect).toBe('error');
    expect(new Headers(init.headers).get('X-XSRF-TOKEN')).toBe(token);
    expect(init.body).toBe(body); expect(init.body).not.toContain(token);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it('bootstraps missing security using only the existing artifact GET', async () => {
    const abort = new AbortController();
    fetchSpy.and.callFake(async (_url: string, init: RequestInit) => {
      if (init.method === 'GET') { setToken(fresh); return new Response('{}'); }
      return new Response('{}', {status: 202});
    });
    await sendJourneyBatch(endpoint, {method: 'POST', body, signal: abort.signal});
    const [url, init] = fetchSpy.calls.first().args;
    expect(url).toBe(location.origin + '/protocol-api/protocol/artifact');
    expect(init.credentials).toBe('same-origin'); expect(init.cache).toBe('no-store');
    expect(init.signal).toBe(abort.signal);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
  it('replays the identical batch once only after a recognized pre-API XSRF rejection', async () => {
    setToken(token); let posts = 0;
    fetchSpy.and.callFake(async (_url: string, init: RequestInit) => {
      if (init.method === 'GET') { setToken(fresh); return new Response('{}'); }
      posts++;
      return new Response(JSON.stringify({detail:'Browser security check failed. Refresh Solslot and try again.'}),
        {status:403, headers:{'X-Solslot-Http-Boundary':'xsrf-v1'}});
    });
    const response = await sendJourneyBatch(endpoint, {method:'POST',body});
    expect(response.status).toBe(403); expect(posts).toBe(2);
    expect(fetchSpy.calls.allArgs().filter(args => args[1].method === 'POST').map(args => args[1].body)).toEqual([body,body]);
    expect(new Headers(fetchSpy.calls.mostRecent().args[1].headers).get('X-XSRF-TOKEN')).toBe(fresh);
  });
  it('never replays an application authorization failure', async () => {
    setToken(token);fetchSpy.and.resolveTo(new Response(JSON.stringify({detail:'Not authorized'}),{status:403}));
    await sendJourneyBatch(endpoint,{method:'POST',body});expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it('does not replay an ambiguous lost response inside security recovery', async () => {
    setToken(token);fetchSpy.and.rejectWith(new TypeError('network'));
    await expectAsync(sendJourneyBatch(endpoint,{method:'POST',body})).toBeRejected();expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it('blocks cross-origin and alternate destinations before reading or sending security material', async () => {
    for (const url of ['https://outside.invalid/alpha/journey-events','/protocol-api/admin/collections','/protocol-api/alpha/journey-events?extra=1']) {
      await expectAsync(sendJourneyBatch(url,{method:'POST',body})).toBeRejected();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('honors revocation during token bootstrap', async () => {
    let allowed = true;
    fetchSpy.and.callFake(async () => {setToken(fresh);allowed=false;return new Response('{}');});
    await expectAsync(sendJourneyBatch(endpoint,{method:'POST',body},()=>allowed)).toBeRejected();
    expect(fetchSpy).toHaveBeenCalledTimes(1);expect(fetchSpy.calls.first().args[1].method).toBe('GET');
  });
  it('does not post after a failed or aborted security bootstrap', async () => {
    fetchSpy.and.resolveTo(new Response('{}',{status:503}));
    await expectAsync(sendJourneyBatch(endpoint,{method:'POST',body})).toBeRejected();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const controller = new AbortController();controller.abort();
    await expectAsync(sendJourneyBatch(endpoint,{method:'POST',body,signal:controller.signal})).toBeRejected();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
