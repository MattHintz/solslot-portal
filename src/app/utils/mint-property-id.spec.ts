import {
  assetClassToCode,
  canonicalCollectionIdHash,
  canonicalizeMintCollectionId,
  canonicalizeMintPropertyId,
  canonicalPropertyIdHash,
} from './mint-property-id';

describe('mint property id helpers', () => {
  it('canonicalises display property ids by stripping and uppercasing', () => {
    expect(canonicalizeMintPropertyId(' us-tx-travis-9001 ')).toBe(
      'US-TX-TRAVIS-9001',
    );
  });

  it('hashes canonical property ids with the protocol sha256 UTF-8 pipeline', () => {
    expect(canonicalPropertyIdHash(' us-tx-travis-9001 ')).toBe(
      '0xdfe4b0ba914dada3fc6b637a7c9ec3424a94b0f371b5d25535f51ae6e6b0692f',
    );
  });

  it('canonicalises and hashes collection ids with the same UTF-8 pipeline', () => {
    expect(canonicalizeMintCollectionId(' us-tx-travis-sfr ')).toBe(
      'US-TX-TRAVIS-SFR',
    );
    expect(canonicalCollectionIdHash(' us-tx-travis-sfr ')).toBe(
      '0xdc617d6bd719ecf863a48526b148861a8d19fa3d14298bfe49d0591e2b3189a3',
    );
  });

  it('maps alpha asset class strings to protocol integer codes', () => {
    expect(assetClassToCode(' rwa-re-res ')).toBe(1);
  });

  it('rejects unknown asset class strings', () => {
    expect(() => assetClassToCode('RWA-SPACEPORT')).toThrowError(
      /unsupported asset_class/,
    );
  });
});
