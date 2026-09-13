import { VerifiedMediaService } from './verified-media.service';
import { AssetDescriptorV1 } from './property-metadata/property-dossier';

describe('VerifiedMediaService resource boundary', () => {
  let asset: AssetDescriptorV1;
  const bytes = new TextEncoder().encode('%PDF-1.7\nchecked');
  beforeEach(async () => {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    asset = { assetId: 'document', cid: 'bafyfixture', uris: ['https://assets.invalid/file', 'ipfs://bafyfixture'],
      sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
      mimeType: 'application/pdf', byteSize: bytes.length };
  });

  for (const contentLength of [undefined, '4194304']) {
    it(`cancels an oversized stream and reaches a matching fallback (length=${contentLength})`, async () => {
      let consumed = 0;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (consumed >= 4_194_304) { controller.close(); return; }
          consumed += 1024;
          controller.enqueue(new Uint8Array(1024));
        },
        cancel() { cancelled = true; },
      });
      const headers: Record<string, string> = { 'content-type': 'application/pdf' };
      if (contentLength) headers['content-length'] = contentLength;
      spyOn(window, 'fetch').and.returnValues(
        Promise.resolve(new Response(body, { headers })),
        Promise.resolve(new Response(bytes, { headers: { 'content-type': 'application/pdf' } })),
      );
      const checked = await new VerifiedMediaService().fetchVerified(asset);
      try {
        expect(checked.sourceUri).toBe('ipfs://bafyfixture');
        expect(cancelled).toBeTrue();
        expect(consumed).toBeLessThan(4096);
      } finally { URL.revokeObjectURL(checked.objectUrl); }
    });
  }

  it('cancels a stalled body at the deadline and uses the matching fallback', async () => {
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() { started(); return new Promise<void>(() => {}); },
      cancel() { cancelled = true; },
    });
    spyOn(window, 'fetch').and.returnValues(
      Promise.resolve(new Response(body, { headers: { 'content-type': 'application/pdf' } })),
      Promise.resolve(new Response(bytes, { headers: { 'content-type': 'application/pdf' } })),
    );
    jasmine.clock().install();
    try {
      const pending = new VerifiedMediaService().fetchVerified(asset);
      await reading;
      jasmine.clock().tick(30_001);
      const checked = await pending;
      expect(cancelled).toBeTrue();
      expect(checked.sourceUri).toBe('ipfs://bafyfixture');
      URL.revokeObjectURL(checked.objectUrl);
    } finally { jasmine.clock().uninstall(); }
  });

  it('does not start a request after cancellation', async () => {
    const fetch = spyOn(window, 'fetch');
    const controller = new AbortController();
    controller.abort();
    await expectAsync(new VerifiedMediaService().fetchVerified(asset, controller.signal)).toBeRejected();
    expect(fetch).not.toHaveBeenCalled();
  });
});
