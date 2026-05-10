import { TestBed } from '@angular/core/testing';

import {
  ZKPASSPORT_EMPTY_ATTEST_ROOT,
  ZkPassportAttestationService,
} from './zkpassport-attestation.service';

const VAULT_LAUNCHER_ID = '0x' + '11'.repeat(32);
const SCOPED_NULLIFIER = '0x' + '22'.repeat(32);
const SERVICE_SCOPE_HASH = '0x' + '33'.repeat(32);
const SERVICE_SUBSCOPE_HASH = '0x' + '44'.repeat(32);
const BRIDGE_POLICY_HASH = '0x' + '55'.repeat(32);
const BRIDGE_COIN_ID = '0x30c14b0547553627bde49cd6021cbddc7e0dea379ce600c8832533027612f065';
const PROOF_TIMESTAMP = 1_779_120_000;
const EXPECTED_LEAF = '0x41950d187f655ae494bcdea426d643d3a21734ae9d3311c34477eb836867fcf7';
const EXPECTED_ROOT_THREE = '0xf332e579325ab8b0248928ca5e462adad87c2b8528588c92e45fb73c978bff34';
const EXPECTED_BRIDGE_MESSAGE = '0x8de348f6526b3bcc752ca1b524f3288c91ddbeb0f9d3451390ffbb0609565a71';
const EXPECTED_VALIDATOR_MESSAGE = '0x3f10937cdd776e5efe748416b36185a2d702540c437426896eb98562dbaddfa7';
const EXPECTED_PAIR_ROOT = '0x2c66600c9d6ab5196b84e5fb389401569af0f4ebcfdac5ce763f4ec34c4c435f';

function attestationInput() {
  return {
    vaultLauncherId: VAULT_LAUNCHER_ID,
    scopedNullifier: SCOPED_NULLIFIER,
    nullifierType: 1,
    serviceScopeHash: SERVICE_SCOPE_HASH,
    serviceSubscopeHash: SERVICE_SUBSCOPE_HASH,
    proofTimestamp: PROOF_TIMESTAMP,
  };
}

describe('ZkPassportAttestationService', () => {
  let service: ZkPassportAttestationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ZkPassportAttestationService);
  });

  it('computes the canonical attestation leaf hash', () => {
    expect(service.computeAttestationLeaf(attestationInput())).toBe(EXPECTED_LEAF);
  });

  it('binds the attestation leaf to the vault launcher id', () => {
    const a = service.computeAttestationLeaf(attestationInput());
    const b = service.computeAttestationLeaf({
      ...attestationInput(),
      vaultLauncherId: '0x' + '12'.repeat(32),
    });
    expect(a).not.toBe(b);
  });

  it('computes empty and single-leaf attestation roots', () => {
    expect(service.computeAttestationRoot([])).toBe(ZKPASSPORT_EMPTY_ATTEST_ROOT);
    expect(service.computeAttestationRoot([EXPECTED_LEAF])).toBe(EXPECTED_LEAF);
  });

  it('duplicates the final node on odd-width merkle levels', () => {
    const leaves = ['0x' + '01'.repeat(32), '0x' + '02'.repeat(32), '0x' + '03'.repeat(32)];
    expect(service.computeAttestationRoot(leaves)).toBe(EXPECTED_ROOT_THREE);
  });

  it('computes the canonical bridge message', () => {
    expect(
      service.computeAttestationBridgeMessage({
        vaultLauncherId: VAULT_LAUNCHER_ID,
        attestationRoot: EXPECTED_LEAF,
        bridgePolicyHash: BRIDGE_POLICY_HASH,
      }),
    ).toBe(EXPECTED_BRIDGE_MESSAGE);
  });

  it('binds bridge messages to the bridge policy hash', () => {
    const a = service.computeAttestationBridgeMessage({
      vaultLauncherId: VAULT_LAUNCHER_ID,
      attestationRoot: EXPECTED_LEAF,
      bridgePolicyHash: BRIDGE_POLICY_HASH,
    });
    const b = service.computeAttestationBridgeMessage({
      vaultLauncherId: VAULT_LAUNCHER_ID,
      attestationRoot: EXPECTED_LEAF,
      bridgePolicyHash: '0x' + '56'.repeat(32),
    });
    expect(a).not.toBe(b);
  });

  it('computes the canonical validator bridge message', () => {
    expect(
      service.computeValidatorBridgeMessage({
        vaultLauncherId: VAULT_LAUNCHER_ID,
        attestationRoot: EXPECTED_LEAF,
        bridgePolicyHash: BRIDGE_POLICY_HASH,
        bridgeCoinId: BRIDGE_COIN_ID,
        bridgeMessage: EXPECTED_BRIDGE_MESSAGE,
        attestationLeafHash: EXPECTED_LEAF,
        scopedNullifier: SCOPED_NULLIFIER,
        nullifierType: 1,
        serviceScopeHash: SERVICE_SCOPE_HASH,
        serviceSubscopeHash: SERVICE_SUBSCOPE_HASH,
        proofTimestamp: PROOF_TIMESTAMP,
      }),
    ).toBe(EXPECTED_VALIDATOR_MESSAGE);
  });

  it('verifies low-bit-first merkle proofs', () => {
    expect(
      service.verifyMerkleProof('0x' + '02'.repeat(32), EXPECTED_PAIR_ROOT, {
        bitpath: 1,
        siblings: ['0x' + '01'.repeat(32)],
      }),
    ).toBeTrue();
  });

  it('rejects wrong merkle proof siblings', () => {
    expect(
      service.verifyMerkleProof('0x' + '02'.repeat(32), EXPECTED_PAIR_ROOT, {
        bitpath: 1,
        siblings: ['0x' + '03'.repeat(32)],
      }),
    ).toBeFalse();
  });

  it('computes the canonical vault subscope string', () => {
    expect(service.computeVaultSubscope(VAULT_LAUNCHER_ID)).toBe(`vault:${VAULT_LAUNCHER_ID}`);
  });

  it('rejects malformed bytes32 inputs', () => {
    expect(() =>
      service.computeAttestationBridgeMessage({
        vaultLauncherId: '0x1234',
        attestationRoot: EXPECTED_LEAF,
        bridgePolicyHash: BRIDGE_POLICY_HASH,
      }),
    ).toThrowError(/vaultLauncherId must be 32 bytes/);
  });
});
