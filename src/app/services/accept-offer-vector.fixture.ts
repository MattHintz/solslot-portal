export interface AcceptOfferAttestationProofVector {
  bitpath: number;
  siblings: string[];
}

export interface AcceptOfferVectorInputs {
  vaultLauncherId: string;
  ownerPubkey: string;
  authType: number;
  membersMerkleRoot: string;
  poolLauncherId: string;
  vaultCoinId: string;
  vaultInnerPuzzleHash: string;
  vaultAmount: number;
  spendCase: string;
  deedLauncherId: string;
  tokenAmount: number;
  poolInnerPuzzleHash: string;
  identityAttestRoot: string;
  attestationLeafHash: string;
  attestationProof: AcceptOfferAttestationProofVector;
  currentTimestamp: number;
  signatureData: string | null;
}

export interface AcceptOfferVectorExpected {
  serializedSolution: string;
  solutionTreeHash: string;
  aggSigMeMessage: string;
  poolAnnouncementAssert: string;
}

export interface AcceptOfferVectorFixture {
  protocolCommit: string;
  inputs: AcceptOfferVectorInputs;
  expected: AcceptOfferVectorExpected;
}

export const ACCEPT_OFFER_PROTOCOL_VECTOR = normalizeAcceptOfferVectorFixture({
  protocolCommit: 'a9e9a53',
  inputs: {
    vaultLauncherId: '0x' + 'aa'.repeat(32),
    ownerPubkey: '0x' + '00'.repeat(48),
    authType: 1,
    membersMerkleRoot: '0x' + 'ee'.repeat(32),
    poolLauncherId: '0x' + 'bb'.repeat(32),
    vaultCoinId: '0x' + '11'.repeat(32),
    vaultInnerPuzzleHash: '0x8beb045c100661077c239ad965fb72c1228dd212c757419ec0f5dbec103fefe5',
    vaultAmount: 1,
    spendCase: '0x61',
    deedLauncherId: '0x' + 'dd'.repeat(32),
    tokenAmount: 100_000,
    poolInnerPuzzleHash: '0x' + 'cc'.repeat(32),
    identityAttestRoot: '0x' + '44'.repeat(32),
    attestationLeafHash: '0x' + '44'.repeat(32),
    attestationProof: { bitpath: 0, siblings: [] },
    currentTimestamp: 1_735_689_600,
    signatureData: null,
  },
  expected: {
    serializedSolution:
      '0xffa01111111111111111111111111111111111111111111111111111111111111111ffa08beb045c100661077c239ad965fb72c1228dd212c757419ec0f5dbec103fefe5ff01ff61ffffa0ddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddff830186a0ffa0ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccffa04444444444444444444444444444444444444444444444444444444444444444ffff8080ff8467748580ff808080',
    solutionTreeHash: '0x8ed1ff5aa20d26c56343e3ad838789f03d2c81a778bfb509b66615271733ad9e',
    aggSigMeMessage: '0x2d33d2424799d4a31f7225871d9a56239729293e44e574c47905587fa84d81db',
    poolAnnouncementAssert: '0x56b6a1ffd1538a3e346f0475ca7818a6ef7d79b27d5e3aedb200aca897383446',
  },
});

export function normalizeAcceptOfferVectorFixture(
  fixture: AcceptOfferVectorFixture,
): AcceptOfferVectorFixture {
  const inputs = fixture.inputs;
  const expected = fixture.expected;
  assertPositiveInteger(inputs.authType, 'inputs.authType');
  assertPositiveInteger(inputs.vaultAmount, 'inputs.vaultAmount');
  assertPositiveInteger(inputs.tokenAmount, 'inputs.tokenAmount');
  assertNonNegativeInteger(inputs.currentTimestamp, 'inputs.currentTimestamp');
  assertNonNegativeInteger(inputs.attestationProof.bitpath, 'inputs.attestationProof.bitpath');
  const normalizedSpendCase = normalizeVectorHex(inputs.spendCase, 'inputs.spendCase', 1);
  if (normalizedSpendCase !== '0x61') {
    throw new Error(`inputs.spendCase must be 0x61, got ${inputs.spendCase}`);
  }
  return {
    protocolCommit: fixture.protocolCommit,
    inputs: {
      vaultLauncherId: normalizeVectorHex(inputs.vaultLauncherId, 'inputs.vaultLauncherId', 32),
      ownerPubkey: normalizeVectorHex(inputs.ownerPubkey, 'inputs.ownerPubkey', 48),
      authType: inputs.authType,
      membersMerkleRoot: normalizeVectorHex(inputs.membersMerkleRoot, 'inputs.membersMerkleRoot', 32),
      poolLauncherId: normalizeVectorHex(inputs.poolLauncherId, 'inputs.poolLauncherId', 32),
      vaultCoinId: normalizeVectorHex(inputs.vaultCoinId, 'inputs.vaultCoinId', 32),
      vaultInnerPuzzleHash: normalizeVectorHex(
        inputs.vaultInnerPuzzleHash,
        'inputs.vaultInnerPuzzleHash',
        32,
      ),
      vaultAmount: inputs.vaultAmount,
      spendCase: normalizedSpendCase,
      deedLauncherId: normalizeVectorHex(inputs.deedLauncherId, 'inputs.deedLauncherId', 32),
      tokenAmount: inputs.tokenAmount,
      poolInnerPuzzleHash: normalizeVectorHex(
        inputs.poolInnerPuzzleHash,
        'inputs.poolInnerPuzzleHash',
        32,
      ),
      identityAttestRoot: normalizeVectorHex(inputs.identityAttestRoot, 'inputs.identityAttestRoot', 32),
      attestationLeafHash: normalizeVectorHex(
        inputs.attestationLeafHash,
        'inputs.attestationLeafHash',
        32,
      ),
      attestationProof: {
        bitpath: inputs.attestationProof.bitpath,
        siblings: inputs.attestationProof.siblings.map((sibling, index) =>
          normalizeVectorHex(sibling, `inputs.attestationProof.siblings[${index}]`, 32),
        ),
      },
      currentTimestamp: inputs.currentTimestamp,
      signatureData:
        inputs.signatureData === null
          ? null
          : normalizeEvenHex(inputs.signatureData, 'inputs.signatureData'),
    },
    expected: {
      serializedSolution: normalizeEvenHex(expected.serializedSolution, 'expected.serializedSolution'),
      solutionTreeHash: normalizeVectorHex(expected.solutionTreeHash, 'expected.solutionTreeHash', 32),
      aggSigMeMessage: normalizeVectorHex(expected.aggSigMeMessage, 'expected.aggSigMeMessage', 32),
      poolAnnouncementAssert: normalizeVectorHex(
        expected.poolAnnouncementAssert,
        'expected.poolAnnouncementAssert',
        32,
      ),
    },
  };
}

export function normalizeVectorHex(value: string, fieldName: string, byteLength: number): string {
  const normalized = normalizeEvenHex(value, fieldName);
  if (normalized.length !== 2 + byteLength * 2) {
    throw new Error(`${fieldName} must be ${byteLength} bytes, got ${normalized.length - 2} hex chars`);
  }
  return normalized;
}

function normalizeEvenHex(value: string, fieldName: string): string {
  const normalized = value.startsWith('0x') || value.startsWith('0X')
    ? `0x${value.slice(2).toLowerCase()}`
    : `0x${value.toLowerCase()}`;
  if (!/^0x[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error(`${fieldName} must be even-length hex`);
  }
  return normalized;
}

function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
}
