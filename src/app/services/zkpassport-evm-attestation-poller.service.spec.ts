import { TestBed } from '@angular/core/testing';

import {
  ValidatorBridgeConfig,
  ZkPassportAttestationEventSource,
  ZkPassportEvmAttestationPollerService,
  ZkPassportRawAttestationEvent,
} from './zkpassport-evm-attestation-poller.service';
import { ZkPassportAttestationService } from './zkpassport-attestation.service';

const VAULT_LAUNCHER_ID = '0x' + '11'.repeat(32);
const SCOPED_NULLIFIER = '0x' + '22'.repeat(32);
const SERVICE_SCOPE_HASH = '0x' + '33'.repeat(32);
const SERVICE_SUBSCOPE_HASH = '0x' + '44'.repeat(32);
const BRIDGE_POLICY_HASH = '0x' + '55'.repeat(32);
const BRIDGE_PARENT_ID = '0x' + '66'.repeat(32);
const VALIDATOR_A = '0x' + 'aa'.repeat(48);
const VALIDATOR_B = '0x' + 'bb'.repeat(48);
const VALIDATOR_C = '0x' + 'cc'.repeat(48);
const SIG_A = '0x' + '11'.repeat(96);
const SIG_C = '0x' + '33'.repeat(96);
const PROOF_TIMESTAMP = 1_779_120_000;

function source(event: ZkPassportRawAttestationEvent | null): ZkPassportAttestationEventSource {
  return {
    latestVaultAttestation: async () => event,
  };
}

function bridgeConfig(): ValidatorBridgeConfig {
  return {
    validatorPubkeys: [VALIDATOR_A, VALIDATOR_B, VALIDATOR_C],
    validatorThreshold: 2,
    bridgeParentId: BRIDGE_PARENT_ID,
    bridgeAmount: 1,
  };
}

describe('ZkPassportEvmAttestationPollerService', () => {
  let service: ZkPassportEvmAttestationPollerService;
  let attestation: ZkPassportAttestationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ZkPassportEvmAttestationPollerService);
    attestation = TestBed.inject(ZkPassportAttestationService);
  });

  function validEvent(overrides: Partial<ZkPassportRawAttestationEvent> = {}): ZkPassportRawAttestationEvent {
    const leaf = attestation.computeAttestationLeaf({
      vaultLauncherId: VAULT_LAUNCHER_ID,
      scopedNullifier: SCOPED_NULLIFIER,
      nullifierType: 1,
      serviceScopeHash: SERVICE_SCOPE_HASH,
      serviceSubscopeHash: SERVICE_SUBSCOPE_HASH,
      proofTimestamp: PROOF_TIMESTAMP,
    });
    const root = attestation.computeAttestationRoot([leaf]);
    const bridgeMessage = attestation.computeAttestationBridgeMessage({
      vaultLauncherId: VAULT_LAUNCHER_ID,
      attestationRoot: root,
      bridgePolicyHash: BRIDGE_POLICY_HASH,
    });
    return {
      sender: '0x0e61d3bb1148bdd802f747caea112333d156626a',
      vaultLauncherId: VAULT_LAUNCHER_ID,
      scopedNullifier: SCOPED_NULLIFIER,
      nullifierType: 1,
      serviceScopeHash: SERVICE_SCOPE_HASH,
      serviceSubscopeHash: SERVICE_SUBSCOPE_HASH,
      proofTimestamp: PROOF_TIMESTAMP,
      attestationLeafHash: leaf,
      attestationRoot: root,
      bridgeMessage,
      bridgePolicyHash: BRIDGE_POLICY_HASH,
      policyVersion: 1,
      transactionHash: '0x' + '99'.repeat(32),
      blockNumber: 123,
      ...overrides,
    };
  }

  it('returns pending when no matching EVM attestation event is visible yet', async () => {
    const result = await service.pollOnce(VAULT_LAUNCHER_ID, {
      source: source(null),
      nowMs: 1_000,
      startedAtMs: 0,
      timeoutMs: 10_000,
      bridgeConfig: bridgeConfig(),
    });
    expect(result.kind).toBe('pending');
  });

  it('returns timeout once the poll window is exhausted', async () => {
    const result = await service.pollOnce(VAULT_LAUNCHER_ID, {
      source: source(validEvent()),
      nowMs: 11_000,
      startedAtMs: 0,
      timeoutMs: 10_000,
      bridgeConfig: bridgeConfig(),
    });
    expect(result.kind).toBe('timeout');
  });

  it('derives enrollment commitments from a matching EVM event', async () => {
    const result = await service.pollOnce(VAULT_LAUNCHER_ID, {
      source: source(validEvent()),
      bridgeConfig: bridgeConfig(),
    });
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.enrollment.vaultLauncherId).toBe(VAULT_LAUNCHER_ID);
    expect(result.enrollment.attestationLeafHash).toBe(
      '0x41950d187f655ae494bcdea426d643d3a21734ae9d3311c34477eb836867fcf7',
    );
    expect(result.enrollment.newIdentityAttestRoot).toBe(result.enrollment.attestationLeafHash);
    expect(result.enrollment.bridgeMessage).toBe(
      '0x8de348f6526b3bcc752ca1b524f3288c91ddbeb0f9d3451390ffbb0609565a71',
    );
    expect(result.enrollment.validatorMessage).toBe(
      '0xe4d2cc41e0f242efbba2b832a54cabab2495bccf100a341cef64b27f4eb67c76',
    );
  });

  it('returns malformed when event commitments do not round-trip', async () => {
    const result = await service.pollOnce(VAULT_LAUNCHER_ID, {
      source: source(validEvent({ bridgeMessage: '0x' + '00'.repeat(32) })),
      bridgeConfig: bridgeConfig(),
    });
    expect(result.kind).toBe('malformed');
    if (result.kind !== 'malformed') return;
    expect(result.reason).toContain('bridge message');
  });

  it('marks bridge spend package insufficient before validator quorum', async () => {
    const result = await service.pollOnce(VAULT_LAUNCHER_ID, {
      source: source(validEvent()),
      bridgeConfig: bridgeConfig(),
      validatorSignatures: [{ validatorPubkey: VALIDATOR_A, signature: SIG_A }],
    });
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.bridgeSpendPackage.backendSigning).toBeFalse();
    expect(result.bridgeSpendPackage.status).toBe('insufficient_signatures');
    expect(result.bridgeSpendPackage.signerIndices).toEqual([0]);
  });

  it('builds a threshold-ready bridge spend package without backend signing', async () => {
    const result = await service.pollOnce(VAULT_LAUNCHER_ID, {
      source: source(validEvent()),
      bridgeConfig: bridgeConfig(),
      validatorSignatures: [
        { validatorPubkey: VALIDATOR_C, signature: SIG_C },
        { validatorPubkey: VALIDATOR_A, signature: SIG_A },
      ],
    });
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.bridgeSpendPackage.backendSigning).toBeFalse();
    expect(result.bridgeSpendPackage.status).toBe('threshold_ready');
    expect(result.bridgeSpendPackage.signerIndices).toEqual([0, 2]);
    expect(result.bridgeSpendPackage.bridgeCoin.puzzleHash).toBe(BRIDGE_POLICY_HASH);
    expect(result.bridgeSpendPackage.bridgeCoin.coinId).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
