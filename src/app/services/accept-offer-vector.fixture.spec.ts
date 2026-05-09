import {
  ACCEPT_OFFER_PROTOCOL_VECTOR,
  AcceptOfferVectorFixture,
  normalizeAcceptOfferVectorFixture,
} from './accept-offer-vector.fixture';

describe('ACCEPT_OFFER_PROTOCOL_VECTOR', () => {
  it('parses and validates the required accept-offer fields', () => {
    const vector = ACCEPT_OFFER_PROTOCOL_VECTOR;

    expect(vector.protocolCommit).toBe('a9e9a53');
    expect(Object.keys(vector.inputs)).toEqual([
      'vaultLauncherId',
      'ownerPubkey',
      'authType',
      'membersMerkleRoot',
      'poolLauncherId',
      'vaultCoinId',
      'vaultInnerPuzzleHash',
      'vaultAmount',
      'spendCase',
      'deedLauncherId',
      'tokenAmount',
      'poolInnerPuzzleHash',
      'identityAttestRoot',
      'attestationLeafHash',
      'attestationProof',
      'currentTimestamp',
      'signatureData',
    ]);
    expect(Object.keys(vector.expected)).toEqual([
      'serializedSolution',
      'solutionTreeHash',
      'aggSigMeMessage',
      'poolAnnouncementAssert',
    ]);
    expect(vector.inputs.spendCase).toBe('0x61');
    expect(vector.inputs.authType).toBe(1);
    expect(vector.inputs.tokenAmount).toBe(100_000);
    expect(vector.inputs.identityAttestRoot).toBe(vector.inputs.attestationLeafHash);
    expect(vector.inputs.attestationProof).toEqual({ bitpath: 0, siblings: [] });
    expect(vector.inputs.signatureData).toBeNull();
    expect(vector.expected.solutionTreeHash).toBe(
      '0x8ed1ff5aa20d26c56343e3ad838789f03d2c81a778bfb509b66615271733ad9e',
    );
  });

  it('normalizes vector hex fields to portal hex conventions', () => {
    const raw = cloneVector();
    raw.inputs.vaultCoinId = '11'.repeat(32).toUpperCase();
    raw.inputs.spendCase = '61';
    raw.inputs.attestationProof = {
      bitpath: 1,
      siblings: ['22'.repeat(32).toUpperCase()],
    };
    raw.expected.solutionTreeHash = raw.expected.solutionTreeHash.slice(2).toUpperCase();

    const normalized = normalizeAcceptOfferVectorFixture(raw);

    expect(normalized.inputs.vaultCoinId).toBe('0x' + '11'.repeat(32));
    expect(normalized.inputs.spendCase).toBe('0x61');
    expect(normalized.inputs.attestationProof.siblings).toEqual(['0x' + '22'.repeat(32)]);
    expect(normalized.expected.solutionTreeHash).toBe(ACCEPT_OFFER_PROTOCOL_VECTOR.expected.solutionTreeHash);
  });

  it('fails loudly for malformed fixture data', () => {
    expect(() =>
      normalizeAcceptOfferVectorFixture({
        ...cloneVector(),
        inputs: { ...cloneVector().inputs, vaultCoinId: '0x12' },
      }),
    ).toThrowError(/vaultCoinId/);

    expect(() =>
      normalizeAcceptOfferVectorFixture({
        ...cloneVector(),
        inputs: { ...cloneVector().inputs, spendCase: '0x62' },
      }),
    ).toThrowError(/spendCase/);

    expect(() =>
      normalizeAcceptOfferVectorFixture({
        ...cloneVector(),
        inputs: { ...cloneVector().inputs, tokenAmount: 0 },
      }),
    ).toThrowError(/tokenAmount/);

    expect(() =>
      normalizeAcceptOfferVectorFixture({
        ...cloneVector(),
        inputs: {
          ...cloneVector().inputs,
          attestationProof: { bitpath: -1, siblings: [] },
        },
      }),
    ).toThrowError(/bitpath/);
  });
});

function cloneVector(): AcceptOfferVectorFixture {
  return JSON.parse(JSON.stringify(ACCEPT_OFFER_PROTOCOL_VECTOR)) as AcceptOfferVectorFixture;
}
