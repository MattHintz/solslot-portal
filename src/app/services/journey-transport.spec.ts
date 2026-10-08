import { JourneyTransport, journeyScreen } from './journey-transport';
describe('Journey telemetry privacy and recovery', () => {
  let transport: JourneyTransport;
  afterEach(() => transport?.dispose());
  it('never sends before consent, and drops queued events after revocation', async () => {
    let allowed = false;
    const sender = jasmine.createSpy().and.resolveTo({ok:true,status:202});
    transport = new JourneyTransport('/intake', 'a'.repeat(40), 'customer', () => allowed, sender);
    transport.record({screen:'identity',action:'sign_in'});
    await transport.flush(); expect(sender).not.toHaveBeenCalled();
    allowed = true; transport.record({screen:'identity',action:'sign_in'});
    allowed = false; await transport.flush();
    allowed = true; await transport.flush(); expect(sender).not.toHaveBeenCalled();
  });
  it('retries the same event IDs after a lost response and reports delivery', async () => {
    const bodies: any[] = [];
    const sender = jasmine.createSpy().and.callFake(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      if (bodies.length === 1) throw new TypeError('connection lost');
      return {ok:true,status:202};
    });
    transport = new JourneyTransport('/intake', 'a'.repeat(40), 'customer', () => true, sender);
    transport.record({screen:'identity',action:'sign_in', wallet:'sage', stage:'awaiting_wallet',phase:'waiting', url:'secret', address:'secret'} as any);
    await transport.flush(); expect(transport.state).toBe('retrying');
    await transport.flush(); expect(transport.delivered).toBe(1);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(JSON.stringify(bodies)).not.toContain('secret');
  });
  it('accepts only a random server receipt and cannot transmit arbitrary header text', async () => {
    const sender = jasmine.createSpy().and.resolveTo({ok:true,status:202});
    transport = new JourneyTransport('/intake', 'a'.repeat(40), 'customer', () => true, sender);
    transport.record({screen:'identity',action:'api_request',request_id:'a'.repeat(32)});
    transport.record({screen:'identity',action:'api_request',request_id:'secret address'});
    await transport.flush();
    const events = JSON.parse(sender.calls.mostRecent().args[1].body).events;
    expect(events[0].request_id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(events[1].request_id).toBeUndefined();
  });
  it('preserves newly opted-in events when an old in-flight batch completes', async () => {
    let complete!: (value:any) => void;
    const sender = jasmine.createSpy().and.callFake(() => new Promise(resolve => complete = resolve));
    transport = new JourneyTransport('/intake', 'a'.repeat(40), 'customer', () => true, sender);
    transport.record({screen:'vault',action:'connect_wallet'});
    const pending = transport.flush();
    transport.clear();
    transport.record({screen:'identity',action:'sign_in'});
    complete({ok:true,status:202}); await pending;
    const next = transport.flush();
    expect(JSON.parse(sender.calls.mostRecent().args[1].body).events[0].action).toBe('sign_in');
    complete({ok:true,status:202}); await next;
  });
  it('normalizes private routes without storing identifiers or queries', () => {
    expect(journeyScreen('/genesis-admin/admin/collections/private-id?token=secret')).toBe('admin_collection');
    expect(journeyScreen('/verify-identity?custom_data=secret')).toBe('identity');
  });
  it('bounded intake failures cannot create an infinite retry loop', async () => {
    const sender = jasmine.createSpy().and.resolveTo({ok:false,status:503});
    transport = new JourneyTransport('/intake', 'a'.repeat(40), 'customer', () => true, sender);
    transport.record({screen:'vault',action:'connect_wallet'});
    for (let i=0;i<4;i++) await transport.flush();
    expect(sender).toHaveBeenCalledTimes(3); expect(transport.dropped).toBe(1);
  });
});
