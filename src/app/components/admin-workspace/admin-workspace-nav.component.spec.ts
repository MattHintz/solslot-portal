import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AdminSessionService } from '../../services/admin-session.service';
import { AdminWorkspaceNavComponent } from './admin-workspace-nav.component';

describe('AdminWorkspaceNavComponent', () => {
  let fixture: ComponentFixture<AdminWorkspaceNavComponent>;
  let logoutAndRedirect: jasmine.Spy;

  beforeEach(async () => {
    logoutAndRedirect = jasmine.createSpy('logoutAndRedirect');
    const session = {
      subject: signal('0x1111111111111111111111111111111111111111'),
      pubkey: signal(PUBKEY_ONE),
      logoutAndRedirect,
    };
    await TestBed.configureTestingModule({
      imports: [AdminWorkspaceNavComponent],
      providers: [
        provideRouter([]),
        { provide: AdminSessionService, useValue: session },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminWorkspaceNavComponent);
    fixture.detectChanges();
  });

  it('shows the secure workspace and every primary work area', () => {
    const text = pageText();
    expect(text).toContain('Administrator');
    expect(text).toContain('Secure workspace');
    expect(text).toContain('Admin desk');
    expect(text).toContain('Properties');
    expect(text).toContain('Approvals');
    expect(text).toContain('Sales');
    expect(text).toContain('Health');
    expect(text).toContain('Security');
  });

  it('signs out through the shared administrator session', () => {
    accountButton('Sign out').click();
    expect(logoutAndRedirect).toHaveBeenCalled();
  });

  it('keeps safety help available from every work area', () => {
    accountButton('Help').click();
    fixture.detectChanges();

    const text = pageText();
    expect(text).toContain('Where should I start?');
    expect(text).toContain('Solslot will never ask for a recovery phrase or private key.');
    expect(text).toContain('Wallet lost or possibly compromised?');
    expect(text).toContain('Open Security & Access');
  });

  it('hands sign-out back to the launch wizard when requested', () => {
    fixture.componentRef.setInput('externalSignOut', true);
    const requested = jasmine.createSpy('requested');
    fixture.componentInstance.signOutRequested.subscribe(requested);

    accountButton('Sign out').click();

    expect(requested).toHaveBeenCalled();
    expect(logoutAndRedirect).not.toHaveBeenCalled();
  });

  function pageText(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function accountButton(label: string): HTMLButtonElement {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('.workspace-account button'),
    ) as HTMLButtonElement[];
    const button = buttons.find((candidate) => candidate.textContent?.trim() === label);
    if (!button) throw new Error(`Missing ${label} account button.`);
    return button;
  }
});

const PUBKEY_ONE = `0x02${'11'.repeat(32)}`;
