import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  LegacyProRecallResponse,
  LegacyProRecallService,
} from '../../../services/legacy-pro-recall.service';
import { LegacyRecallComponent } from './legacy-recall.component';

describe('LegacyRecallComponent', () => {
  let fixture: ComponentFixture<LegacyRecallComponent>;
  let component: LegacyRecallComponent;
  let recall: jasmine.SpyObj<Pick<LegacyProRecallService, 'search'>>;

  beforeEach(async () => {
    recall = jasmine.createSpyObj('LegacyProRecallService', ['search']);
    recall.search.and.resolveTo(recallResponse());

    await TestBed.configureTestingModule({
      imports: [LegacyRecallComponent],
      providers: [
        provideRouter([]),
        { provide: LegacyProRecallService, useValue: recall },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LegacyRecallComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('keeps legacy pro account/vault recall search behavior intact', async () => {
    component.query = 'fear@solomonslot.com';
    await component.search();
    fixture.detectChanges();

    expect(recall.search).toHaveBeenCalledOnceWith('fear@solomonslot.com');
    const text = hostText();
    expect(text).toContain('1 deprecated record');
    expect(text).toContain('legacy_pro_accounts_and_pro_vaults');
    expect(text).toContain('vault_legacy_001');
  });

  it('keeps retired Solslot offer rows out of the active offer-ready flow', () => {
    const text = hostText();

    expect(text).toContain('Retired Solslot offers');
    expect(text).toContain('historical evidence only');
    expect(text).toContain('Pro Account and Pro Vault records');
    expect(text).not.toContain('OP:OFFER_READY');
    expect(text).not.toContain('Inspect bundle');
  });

  it('surfaces search failures and clears stale records', async () => {
    component.query = 'fear@solomonslot.com';
    await component.search();
    recall.search.and.rejectWith(new Error('backend offline'));

    await component.search();
    fixture.detectChanges();

    const text = hostText();
    expect(text).toContain('Legacy recall failed.');
    expect(text).toContain('backend offline');
    expect(component.records()).toEqual([]);
  });

  function hostText(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }
});

function recallResponse(): LegacyProRecallResponse {
  return {
    deprecated: true,
    system: 'legacy_pro_accounts_and_pro_vaults',
    query: 'fear@solomonslot.com',
    count: 1,
    records: [
      {
        source: 'redis',
        id: 'legacy_pro_accounts_and_pro_vaults',
        deprecated: true,
        data: {
          vault_id: 'vault_legacy_001',
        },
      },
    ],
  };
}
