import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { environment } from '../../environments/environment';
import { AdminBootstrapService } from './admin-bootstrap.service';

describe('AdminBootstrapService', () => {
  let service: AdminBootstrapService;
  let http: HttpTestingController;
  const finalizeRequest = {
    admin_records: {
      version: 1,
      launcher_id: `0x${'88'.repeat(32)}`,
      admin_records: [
        {
          admin_idx: 0,
          m_within: 1,
          leaves: [
            {
              kind: 'eip712_member',
              leaf_hash: `0x${'99'.repeat(32)}`,
              evm_address: `0x${'aa'.repeat(20)}`,
              secp256k1_pubkey: `0x02${'bb'.repeat(32)}`,
              type_hash: `0x${'cc'.repeat(32)}`,
              prefix_and_domain_separator: `0x1901${'dd'.repeat(32)}`,
            },
          ],
        },
      ],
    },
    admin_authority_launcher_id: `0x${'88'.repeat(32)}`,
    admins_hash: `0x${'ab'.repeat(32)}`,
    mips_root: `0x${'cd'.repeat(32)}`,
    read_only_api_url: 'https://api.populis.example',
    read_only_coinset_url: 'https://coinset.example',
  };
  const protocol = {
    pool_launcher_id: `0x${'11'.repeat(32)}`,
    did_launcher_id: `0x${'22'.repeat(32)}`,
    tracker_launcher_id: `0x${'33'.repeat(32)}`,
    pgt_tail_hash: `0x${'44'.repeat(32)}`,
    pool_token_tail_hash: `0x${'55'.repeat(32)}`,
    pool_full_puzhash: `0x${'66'.repeat(32)}`,
    tracker_full_puzhash: `0x${'77'.repeat(32)}`,
  };
  const artifactHashes = {
    deployment_manifest_json: `sha256:${'01'.repeat(32)}`,
    admin_records_json: `sha256:${'12'.repeat(32)}`,
    portal_runtime_config_json: `sha256:${'23'.repeat(32)}`,
  };
  const recoveryAnchor = {
    version: 1,
    tag: 'POPULIS_BOOTSTRAP_V1',
    network: 'testnet11',
    admin_authority_v2_launcher_id: finalizeRequest.admin_authority_launcher_id,
    authority_version: 1,
    bootstrap_manifest_hash: `sha256:${'34'.repeat(32)}`,
    portal_runtime_config_hash: `sha256:${'23'.repeat(32)}`,
    admin_records_hash: `sha256:${'12'.repeat(32)}`,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AdminBootstrapService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('starts a bootstrap session with the pasted one-shot token and credentials', async () => {
    const promise = service.startBootstrapSession(' bootstrap-token ');

    const req = http.expectOne(`${environment.faucetApi}/admin/bootstrap/challenge`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeNull();
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.get('Authorization')).toBe('Bearer bootstrap-token');
    req.flush({ unlocked: true, expires_at: 1234 });

    await expectAsync(promise).toBeResolvedTo({ unlocked: true, expires_at: 1234 });
  });

  it('checks bootstrap status with credentials and without resending the raw token', async () => {
    const promise = service.getBootstrapStatus();

    const req = http.expectOne(`${environment.faucetApi}/admin/bootstrap/status`);
    expect(req.request.method).toBe('GET');
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({ locked: false, authenticated: true, expires_at: 1234 });

    await expectAsync(promise).toBeResolvedTo({ locked: false, authenticated: true, expires_at: 1234 });
  });

  it('finalizes bootstrap artifacts with cookie credentials and without bearer credentials', async () => {
    const response = {
      locked: true,
      bootstrap_manifest: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: finalizeRequest.admin_authority_launcher_id,
          admins_hash: finalizeRequest.admins_hash,
          mips_root: finalizeRequest.mips_root,
          authority_version: 1,
        },
        artifact_hashes: artifactHashes,
      },
      portal_runtime_config: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: finalizeRequest.admin_authority_launcher_id,
          admins_hash: finalizeRequest.admins_hash,
          mips_root: finalizeRequest.mips_root,
          authority_version: 1,
          admin_records_hash: `sha256:${'12'.repeat(32)}`,
        },
        read_only_api_url: finalizeRequest.read_only_api_url,
        read_only_coinset_url: finalizeRequest.read_only_coinset_url,
      },
      bootstrap_recovery_anchor: recoveryAnchor,
    };
    const promise = service.finalizeBootstrap(finalizeRequest);

    const req = http.expectOne(`${environment.faucetApi}/admin/bootstrap/finalize`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(finalizeRequest);
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush(response);

    await expectAsync(promise).toBeResolvedTo(response);
  });

  it('verifies recovery artifacts without credentials or bearer headers', async () => {
    const request = {
      bootstrap_recovery_anchor: recoveryAnchor,
      bootstrap_manifest: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: finalizeRequest.admin_authority_launcher_id,
          admins_hash: finalizeRequest.admins_hash,
          mips_root: finalizeRequest.mips_root,
          authority_version: 1,
        },
        artifact_hashes: artifactHashes,
      },
      portal_runtime_config: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: finalizeRequest.admin_authority_launcher_id,
          admins_hash: finalizeRequest.admins_hash,
          mips_root: finalizeRequest.mips_root,
          authority_version: 1,
          admin_records_hash: `sha256:${'12'.repeat(32)}`,
        },
        read_only_api_url: finalizeRequest.read_only_api_url,
        read_only_coinset_url: finalizeRequest.read_only_coinset_url,
      },
      admin_records: finalizeRequest.admin_records,
    };
    const response = {
      verified: true,
      deployment_manifest_verified: false,
      live_authority_verified: false,
      network: 'testnet11',
      admin_authority_v2_launcher_id: finalizeRequest.admin_authority_launcher_id,
      admins_hash: finalizeRequest.admins_hash,
      mips_root: finalizeRequest.mips_root,
      authority_version: 1,
      bootstrap_manifest_hash: recoveryAnchor.bootstrap_manifest_hash,
      portal_runtime_config_hash: recoveryAnchor.portal_runtime_config_hash,
      admin_records_hash: recoveryAnchor.admin_records_hash,
      deployment_manifest_hash: null,
      error: null,
    };
    const promise = service.verifyRecoveryArtifacts(request);

    const req = http.expectOne(`${environment.faucetApi}/admin/bootstrap/recovery-anchor/verify`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    expect(req.request.withCredentials).toBeFalse();
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush(response);

    await expectAsync(promise).toBeResolvedTo(response);
  });

  it('rejects blank tokens before making HTTP requests', async () => {
    await expectAsync(service.startBootstrapSession('   ')).toBeRejectedWithError(/token is required/);
    http.expectNone(`${environment.faucetApi}/admin/bootstrap/challenge`);
  });

  it('does not persist bootstrap credentials in browser storage', async () => {
    const setItem = spyOn(Storage.prototype, 'setItem').and.callThrough();

    const promise = service.startBootstrapSession('bootstrap-token');
    const req = http.expectOne(`${environment.faucetApi}/admin/bootstrap/challenge`);
    req.flush({ unlocked: true, expires_at: 1234 });

    await promise;

    expect(setItem).not.toHaveBeenCalled();
  });

  it('does not persist finalized public artifacts in browser storage', async () => {
    const setItem = spyOn(Storage.prototype, 'setItem').and.callThrough();
    const promise = service.finalizeBootstrap(finalizeRequest);
    const req = http.expectOne(`${environment.faucetApi}/admin/bootstrap/finalize`);
    req.flush({
      locked: true,
      bootstrap_manifest: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: finalizeRequest.admin_authority_launcher_id,
          admins_hash: finalizeRequest.admins_hash,
          mips_root: finalizeRequest.mips_root,
          authority_version: 1,
        },
        artifact_hashes: artifactHashes,
      },
      portal_runtime_config: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: finalizeRequest.admin_authority_launcher_id,
          admins_hash: finalizeRequest.admins_hash,
          mips_root: finalizeRequest.mips_root,
          authority_version: 1,
          admin_records_hash: `sha256:${'12'.repeat(32)}`,
        },
        read_only_api_url: finalizeRequest.read_only_api_url,
        read_only_coinset_url: finalizeRequest.read_only_coinset_url,
      },
      bootstrap_recovery_anchor: recoveryAnchor,
    });

    await promise;

    expect(setItem).not.toHaveBeenCalled();
  });
});
