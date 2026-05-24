import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';

import {
  AdminAuthorityResponse,
  AdminAuthorityV2Response,
} from '../../../services/admin-api.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { ChiaSingletonReaderService } from '../../../services/chia-singleton-reader.service';
import { ChiaWasmService } from '../../../services/chia-wasm.service';
import { OnChainStateService } from '../../../services/on-chain-state.service';
import { ProtocolInfo } from '../../../services/populis-api.service';
import { TrustRootsComponent } from './trust-roots.component';

describe('TrustRootsComponent', () => {
  let fixture: ComponentFixture<TrustRootsComponent>;
  let http: jasmine.SpyObj<{ get: (url: string) => Observable<unknown> }>;

  beforeEach(async () => {
    http = jasmine.createSpyObj('HttpClient', ['get']);
    http.get.and.callFake((url: string) => {
      if (url.endsWith('/admin/auth/authority')) return of(adminAuthority());
      if (url.endsWith('/protocol')) return of(protocolWithoutA3());
      if (url.endsWith('/admin/auth/authority_v2')) return of(adminAuthorityV2());
      throw new Error(`unexpected url ${url}`);
    });

    await TestBed.configureTestingModule({
      imports: [TrustRootsComponent],
      providers: [
        provideRouter([]),
        { provide: HttpClient, useValue: http },
        { provide: OnChainStateService, useValue: {} },
        { provide: AdminSessionService, useValue: {} },
        { provide: ChiaSingletonReaderService, useValue: {} },
        { provide: ChiaWasmService, useValue: { ready: signal(true).asReadonly() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TrustRootsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('explains A.3 launch requirements for non-technical admins when vault registration is locked', () => {
    const text = normalizeText(fixture.nativeElement.textContent as string);

    expect(text).toContain('Vault registration is locked');
    expect(text).toContain(
      'A.3 is the protocol configuration trust root. It records the pool, governance,',
    );
    expect(text).toContain('Who launches it');
    expect(text).toContain(
      "An authorized technical protocol operator launches this singleton after the firm's off-chain approval record is complete.",
    );
    expect(text).toContain(
      'This page does not create legal approval, register a vault, mint securities, or ask for private keys.',
    );
    expect(text).toContain('What must be ready');
    expect(text).toContain('Approved pool launcher id.');
    expect(text).toContain('Approved governance launcher id.');
    expect(text).toContain('Correct network, such as testnet11 or mainnet.');
    expect(text).toContain('Governance public key and a funded Chia wallet coin for the singleton launch.');
    expect(text).toContain('After launch');
    expect(text).toContain('Capture the A.3 launcher id.');
    expect(text).toContain('Set POPULIS_PROTOCOL_CONFIG_LAUNCHER_ID in the API environment.');
    expect(text).toContain('Restart the API, then verify /protocol and this Trust Roots card.');
    expect(text).toContain(
      'Keep the approval record, launcher id, environment change, and verification result for audit review.',
    );
    expect(text).toContain('Technical support procedure: populis_api/GENESIS_README.md §A.3');
    expect(text).toContain('populis_api/SECURITY.md §A.3');
    expect(component().protocolConfigStatus()).toEqual({ kind: 'not-configured' });
  });

  function component(): TrustRootsComponent {
    return fixture.componentInstance;
  }
});

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function adminAuthority(): AdminAuthorityResponse {
  return {
    enabled: false,
    launcher_id: null,
    allowlist_pubkey_hashes: null,
    quorum_m: null,
    authority_version: null,
    state_hash: null,
    phase: '2-informational-only',
    gating_source: 'POPULIS_ADMIN_PUBKEY_ALLOWLIST',
    informational_only: true,
  };
}

function adminAuthorityV2(): AdminAuthorityV2Response {
  return {
    enabled: false,
    launcher_id: null,
    mips_root_hash: null,
    admins_hash: null,
    pending_ops_hash: null,
    authority_version: null,
    state_hash: null,
    phase: '1-not-deployed',
    gating_source: 'POPULIS_ADMIN_PUBKEY_ALLOWLIST',
    informational_only: true,
  };
}

function protocolWithoutA3(): ProtocolInfo {
  return {
    network: 'testnet11',
    pool_launcher_id: null,
    governance_launcher_id: null,
    vault_inner_mod_hash: '',
    eip712_domain: {
      name: 'Populis',
      version: '1',
      chainId: 11,
    },
    eip712_typehash_string: 'ChiaCoinSpend(bytes32 coin_id,bytes32 delegated_puzzle_hash)',
    faucet_address: null,
    faucet_balance_mojos: null,
    deployed: false,
    deployment_manifest: null,
    protocol_config_hash: null,
    protocol_config_launcher_id: null,
    protocol_config_version: 0,
    property_registry_launcher_id: null,
    property_registry_mod_hash: null,
    mint_proposal_mod_hash: null,
  };
}
