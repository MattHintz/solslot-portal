import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';
import {
  AdminOperationApproval,
  AdminOperationApprovalService,
} from './admin-operation-approval.service';
import { EvmWalletService } from './evm-wallet.service';
import { Eip712TypedData } from './solslot-api.service';

const typedData: Eip712TypedData = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
    ],
    SolslotAdminOperation: [
      { name: 'authorityLauncherId', type: 'bytes32' },
    ],
  },
  primaryType: 'SolslotAdminOperation',
  domain: { name: 'Solslot Protocol', version: '2', chainId: 11155111 },
  message: { authorityLauncherId: `0x${'11'.repeat(32)}` },
};

function approval(status: 'pending' | 'approved' | 'consumed'): AdminOperationApproval {
  return {
    schemaVersion: 1,
    operationId: `0x${'22'.repeat(32)}`,
    status,
    operation: 'collection.seal',
    payloadHash: `0x${'33'.repeat(32)}`,
    revision: 5,
    expiresAt: 1_800_000_000,
    authorityLauncherId: `0x${'11'.repeat(32)}`,
    network: 'testnet11',
    nonce: `0x${'55'.repeat(32)}`,
    createdBy: `0x${'66'.repeat(20)}`,
    createdAt: 1_799_999_900,
    requestBinding: {
      method: 'POST',
      path: '/admin/collections/alpha/seal',
      query: [['mode', 'strict']],
      body: {},
      ifMatch: '"5"',
    },
    signatures: [],
    typedData,
  };
}

describe('AdminOperationApprovalService', () => {
  let http: HttpTestingController;
  let service: AdminOperationApprovalService;
  let wallet: jasmine.SpyObj<EvmWalletService>;

  beforeEach(() => {
    wallet = jasmine.createSpyObj<EvmWalletService>('EvmWalletService', ['signTypedData', 'signAuthorityV3ChiaAction', 'address']);
    wallet.signTypedData.and.resolveTo(`0x${'44'.repeat(65)}`);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AdminSessionService, useValue: { requireJwt: () => 'admin-jwt', subject: () => 'admin', pubkey: () => '0x02', authoritySlot: () => 0 } },
        { provide: EvmWalletService, useValue: wallet },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(AdminOperationApprovalService);
  });

  afterEach(() => http.verify());

  it('prepares the exact request and signs only the returned typed data', async () => {
    const pending = service.prepareAndSign({
      operation: 'collection.seal',
      revision: 5,
      binding: approval('pending').requestBinding,
    });
    const prepare = http.expectOne(`${environment.faucetApi}/admin/auth/operations/prepare`);
    expect(prepare.request.headers.get('Authorization')).toBe('Bearer admin-jwt');
    expect(prepare.request.body).toEqual({
      operation: 'collection.seal',
      revision: 5,
      expiresInSeconds: 600,
      requestBinding: approval('pending').requestBinding,
    });
    prepare.flush(approval('pending'));

    await Promise.resolve();
    await Promise.resolve();
    const sign = http.expectOne(
      `${environment.faucetApi}/admin/auth/operations/${approval('pending').operationId}/sign`,
    );
    expect(wallet.signTypedData).toHaveBeenCalledOnceWith(typedData);
    expect(sign.request.body).toEqual({ signature: `0x${'44'.repeat(65)}` });
    sign.flush(approval('pending'));
    expect((await pending).status).toBe('pending');
  });

  it('executes only the server-returned binding with the approval header', async () => {
    const result = service.execute<{ sealed: boolean }>(approval('approved'));
    const request = http.expectOne(
      `${environment.faucetApi}/admin/collections/alpha/seal?mode=strict`,
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    expect(request.request.headers.get('If-Match')).toBe('"5"');
    expect(request.request.headers.get('X-Solslot-Admin-Operation-Id')).toBe(
      approval('approved').operationId,
    );
    request.flush({ sealed: true });
    expect(await result).toEqual({ sealed: true });
  });

  it('requires the current mint chain action and submits it with the HTTP approval', async () => {
    const mint = { ...approval('pending'), operation: 'mint.publish' as const,
      typedData: { ...typedData, message: { ...typedData.message, operation: 'mint.publish' } },
      chainActions: [{ actionId: '0xaction', signerSlot: 0, signerPublicKey: '0x02', coinId: '0xcoin',
        delegatedPuzzleHash: '0xpuzzle', typedData, messageHash: '0xhash', network: 'Testnet11',
        title: 'Publish mint', summary: 'Exact package', financialEffect: 'Lock SGT', signed: false }],
    };
    wallet.signAuthorityV3ChiaAction.and.resolveTo('0xchain');
    const pending = service.sign(mint.operationId, mint.typedData);
    http.expectOne(`${environment.faucetApi}/admin/auth/operations/${mint.operationId}`).flush(mint);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const sign = http.expectOne(`${environment.faucetApi}/admin/auth/operations/${mint.operationId}/sign`);
    expect(wallet.signAuthorityV3ChiaAction).toHaveBeenCalledOnceWith(typedData,
      { coinId: '0xcoin', delegatedPuzzleHash: '0xpuzzle', compressedPubkey: '0x02' });
    expect(sign.request.body).toEqual({ signature: `0x${'44'.repeat(65)}`, chainActionId: '0xaction', chainSignature: '0xchain' });
    sign.flush(mint);
    expect((await pending).operation).toBe('mint.publish');
  });
});
