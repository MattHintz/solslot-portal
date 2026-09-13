import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DocumentAssetV1 } from '../../services/property-metadata/property-dossier';
import { VerifiedMediaService } from '../../services/verified-media.service';
import { VerifiedDocumentComponent } from './verified-document.component';

describe('VerifiedDocumentComponent', () => {
  let fixture: ComponentFixture<VerifiedDocumentComponent>;
  const bytes = new TextEncoder().encode('%PDF-1.7\nreviewed document');
  let asset: DocumentAssetV1;
  let respond: (value: Response) => void;
  let verification: jasmine.Spy;

  beforeEach(async () => {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    asset = {
      assetId: 'appraisal', title: 'Property appraisal', category: 'valuation',
      uris: ['https://assets.invalid/reviewed.pdf'], cid: 'bafyfixture',
      sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
      mimeType: 'application/pdf', byteSize: bytes.byteLength,
    };
    spyOn(window, 'fetch').and.callFake(() => new Promise<Response>((resolve) => { respond = resolve; }));
    await TestBed.configureTestingModule({
      imports: [VerifiedDocumentComponent], providers: [VerifiedMediaService],
    }).compileComponents();
    verification = spyOn(TestBed.inject(VerifiedMediaService), 'fetchVerified').and.callThrough();
    fixture = TestBed.createComponent(VerifiedDocumentComponent);
    fixture.componentRef.setInput('asset', asset);
    fixture.detectChanges();
    expect(verification).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();
  });

  async function finish(body: Uint8Array, mime = 'application/pdf'): Promise<void> {
    respond(new Response(new Blob([body as BlobPart]), { headers: { 'content-type': mime } }));
    await verification.calls.mostRecent().returnValue.catch(() => undefined);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('exposes only checked blob bytes and never the storage URL', async () => {
    expect(fixture.nativeElement.querySelector('a')).toBeNull();
    await finish(bytes);
    const link = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toMatch(/^blob:/);
    expect(link.download).toBe('appraisal.pdf');
    expect(fixture.nativeElement.textContent).toContain('metadata root is not verified');
    expect(fixture.nativeElement.innerHTML).not.toContain(asset.uris[0]);
  });

  it('withholds altered bytes even when the original storage URI is available', async () => {
    await finish(new TextEncoder().encode('%PDF-1.7\naltered document!'));
    expect(fixture.nativeElement.querySelector('a')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('File withheld');
    expect(fixture.nativeElement.querySelector('button').textContent).toContain('Retry');
  });

  it('withholds bytes served with the wrong MIME type', async () => {
    await finish(bytes, 'text/html');
    expect(fixture.nativeElement.querySelector('a')).toBeNull();
  });

  it('withholds a mismatched declared size', async () => {
    const previous = respond;
    fixture.componentRef.setInput('asset', { ...asset, byteSize: bytes.byteLength + 1 });
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button').click();
    previous(new Response(bytes, { headers: { 'content-type': 'application/pdf' } }));
    await finish(bytes);
    expect(fixture.nativeElement.querySelector('a')).toBeNull();
  });

  it('revokes completed object URLs when destroyed', async () => {
    const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();
    await finish(bytes);
    const url = fixture.componentInstance.objectUrl();
    fixture.destroy();
    expect(revoke).toHaveBeenCalledWith(url!);
  });

  it('discards results that finish after destruction', async () => {
    const create = spyOn(URL, 'createObjectURL').and.callThrough();
    fixture.destroy();
    respond(new Response(bytes, { headers: { 'content-type': 'application/pdf' } }));
    await verification.calls.mostRecent().returnValue.catch(() => undefined);
    await fixture.whenStable();
    expect(fixture.componentInstance.objectUrl()).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
