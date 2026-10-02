import { signal } from '@angular/core';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminSessionService } from '../../../services/admin-session.service';
import { MintProposalApiService } from '../../../services/mint-proposal-api.service';
import { MintProposalResponse } from '../../../services/admin-api.service';
import { MintListComponent } from './mint-list.component';

describe('Live mint proposal list', () => {
  const example = { id: 'example', property_id: 'Example property', collection_id: 'example',
    state: 'DRAFT', par_value: 100, owner_pubkey: 'example-owner',
    timestamps: { created_at: 1 } } as MintProposalResponse;
  let list: jasmine.Spy;
  let authenticated: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    list = jasmine.createSpy('read proposals').and.resolveTo({ proposals: [] });
    authenticated = signal(true);
    TestBed.configureTestingModule({ imports: [MintListComponent], providers: [provideRouter([]),
      { provide: MintProposalApiService, useValue: { list } },
      { provide: AdminSessionService, useValue: { subject: () => 'example-owner',
        isAuthenticated: authenticated, expiresAt: () => Math.floor(Date.now() / 1000) + 3600 } },
    ] });
  });

  it('shows proposals arriving after the initial empty result without reloading the page', fakeAsync(() => {
    const fixture = TestBed.createComponent(MintListComponent);
    fixture.detectChanges(); flushMicrotasks(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Start with a property');
    list.and.resolveTo({ proposals: [example] });
    tick(15_000); flushMicrotasks(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Example property');
    expect(fixture.nativeElement.querySelector('.mint-empty-state')).toBeNull();
    fixture.destroy();
  }));

  it('retains successful results during a failure and clears the error after recovery', fakeAsync(() => {
    list.and.resolveTo({ proposals: [example] });
    const fixture = TestBed.createComponent(MintListComponent);
    fixture.detectChanges(); flushMicrotasks();
    const previousCheck = fixture.componentInstance.refresh.lastUpdated();
    list.and.rejectWith(new Error('Temporary service outage'));
    tick(15_000); flushMicrotasks(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Could not update proposals');
    expect(fixture.componentInstance.proposals()).toEqual([example]);
    expect(fixture.componentInstance.refresh.lastUpdated()).toBe(previousCheck);
    expect(fixture.componentInstance.loading()).toBeFalse();
    list.and.resolveTo({ proposals: [] });
    tick(30_000); flushMicrotasks(); fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBeNull();
    expect(fixture.componentInstance.refresh.error()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Start with a property');
    fixture.destroy();
  }));

  it('does not mistake an initial failed read for an empty list', fakeAsync(() => {
    list.and.rejectWith(new Error('Temporary service outage'));
    const fixture = TestBed.createComponent(MintListComponent);
    fixture.detectChanges(); flushMicrotasks(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Could not load proposals');
    expect(fixture.nativeElement.querySelector('.mint-empty-state')).toBeNull();
    list.and.resolveTo({ proposals: [] });
    void fixture.componentInstance.reload(); flushMicrotasks(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Start with a property');
    fixture.destroy();
  }));

  it('pauses reads after administrator access expires', fakeAsync(() => {
    const fixture = TestBed.createComponent(MintListComponent);
    fixture.detectChanges(); flushMicrotasks();
    authenticated.set(false); tick(15_000); flushMicrotasks(); fixture.detectChanges();
    expect(list).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Sign in again');
    fixture.destroy();
  }));
});
