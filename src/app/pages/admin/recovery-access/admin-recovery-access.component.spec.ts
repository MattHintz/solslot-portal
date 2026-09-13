import { RECOVERY_DRILL_API_FIXTURES } from '../../../services/recovery-drill-api.fixture';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { createAdminRecoveryDrillPackage } from '../../../services/admin-recovery-handoff';
import { AdminRecoveryKitService } from '../../../services/admin-recovery-kit.service';
import { RecoveryDrillChallenge } from '../../../services/admin-security.service';
import { AdminRecoveryAccessComponent } from './admin-recovery-access.component';

describe('AdminRecoveryAccessComponent', () => {
  let fixture: ComponentFixture<AdminRecoveryAccessComponent>;
  let component: AdminRecoveryAccessComponent;
  const recoveryKit = {
    unlock: jasmine.createSpy('unlock'),
    signDrill: jasmine.createSpy('signDrill').and.resolveTo({
      evmSignature: `0x${'22'.repeat(65)}`,
      blsSignature: `0x${'33'.repeat(96)}`,
    }),
    clear: jasmine.createSpy('clear'),
  };

  beforeEach(async () => {
    recoveryKit.unlock.calls.reset();
    recoveryKit.signDrill.calls.reset();
    recoveryKit.clear.calls.reset();
    await TestBed.configureTestingModule({
      imports: [AdminRecoveryAccessComponent],
      providers: [
        provideRouter([]),
        { provide: AdminRecoveryKitService, useValue: recoveryKit },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminRecoveryAccessComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('explains that signing is local and no authority or funds change', () => {
    const text = pageText();
    expect(text).toContain('never contacts the Solslot API');
    expect(text).toContain('Solslot support will never ask for these words');
    expect(text).toContain('there is no support bypass');
  });

  it('refuses a package with an altered checksum', () => {
    const drillPackage = createAdminRecoveryDrillPackage(challenge());
    drillPackage.challenge.revision = 2;
    component.packageText = JSON.stringify(drillPackage);

    component.reviewPackage();

    expect(component.reviewedPackage()).toBeNull();
    expect(component.error()).toContain('checksum does not match');
  });

  it('signs locally and clears the phrase and in-memory keys', async () => {
    component.packageText = JSON.stringify(createAdminRecoveryDrillPackage(challenge()));
    component.reviewPackage();
    component.phrase = 'test phrase';
    component.trustedDeviceConfirmed = true;

    await component.signTest(component.reviewedPackage()!);

    expect(recoveryKit.unlock).toHaveBeenCalled();
    expect(recoveryKit.signDrill).toHaveBeenCalled();
    expect(component.resultText()).toContain(`0x${'22'.repeat(65)}`);
    expect(component.phrase).toBe('');
    expect(recoveryKit.clear).toHaveBeenCalled();
  });

  it('clears an earlier review before rejecting another package', () => {
    component.packageText = JSON.stringify(createAdminRecoveryDrillPackage(challenge()));
    component.reviewPackage();
    component.trustedDeviceConfirmed = true;
    component.phrase = 'test phrase';
    component.packageText = '{}';
    component.reviewPackage();
    expect(component.reviewedPackage()).toBeNull();
    expect(component.trustedDeviceConfirmed).toBeFalse();
    expect(component.phrase).toBe('');
    expect(component.resultText()).toBe('');
    expect(recoveryKit.signDrill).not.toHaveBeenCalled();
  });

  it('never asks for or unlocks the phrase for unsupported Chia recovery', async () => {
    component.reviewedChiaPackage.set({} as any);
    fixture.detectChanges();
    expect(pageText()).toContain('Chia recovery signing is unavailable');
    expect((fixture.nativeElement as HTMLElement).querySelector('textarea[placeholder="Enter all 24 words in order"]')).toBeNull();
    await component.signReviewed();
    expect(recoveryKit.unlock).not.toHaveBeenCalled();
    expect(component.resultText()).toBe('');
  });

  function pageText(): string {
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }
});

function challenge(): RecoveryDrillChallenge {
  return structuredClone(RECOVERY_DRILL_API_FIXTURES[0].challenge);
}
