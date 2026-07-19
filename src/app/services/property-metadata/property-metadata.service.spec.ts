import fixture from './property-metadata-v1.fixture.json';

import { hexToBytes } from '../../utils/chia-hash';
import {
  PropertyMetadataError,
  PropertyMetadataService,
  buildMetadataMemos,
  canonicalizeJcs,
  reconstructMetadataMemos,
} from './property-metadata.service';
import { PropertyDossierV1 } from './property-dossier';


describe('PropertyMetadataService', () => {
  const service = new PropertyMetadataService();

  it('matches the Python canonical JSON, root, and memo envelope', () => {
    const commitment = service.commit(fixture.dossier as PropertyDossierV1);
    expect(commitment.canonicalJson).toBe(fixture.canonicalJson);
    expect(commitment.metadataRoot).toBe(fixture.metadataRoot);
    expect(commitment.byteSize).toBe(fixture.canonicalByteSize);
    expect(buildMetadataMemos(commitment).map((memo) => `0x${toHex(memo)}`)).toEqual(
      fixture.memoHex,
    );
  });

  it('reconstructs the fixture and rejects missing, reordered, or altered chunks', () => {
    const memos = fixture.memoHex.map(hexToBytes);
    expect(reconstructMetadataMemos(memos).metadataRoot).toBe(fixture.metadataRoot);
    expect(() => reconstructMetadataMemos(memos.slice(0, -1))).toThrowError(
      /chunk count mismatch/i,
    );
    expect(() => reconstructMetadataMemos([memos[0], memos[2], memos[1], ...memos.slice(3)]))
      .toThrowError(/reordered/i);
    const altered = memos.map((memo) => memo.slice());
    altered[altered.length - 1][altered[altered.length - 1].length - 1] ^= 1;
    expect(() => reconstructMetadataMemos(altered)).toThrowError(/root mismatch/i);
  });

  it('rejects floats and invalid deed allocations', () => {
    expect(() => canonicalizeJcs({ amount: 1.25 })).toThrowError(PropertyMetadataError);
    expect(() =>
      service.validateDeedAllocation([
        { deedId: 'A', sharePpm: 600_000, parValueMojos: '1' },
        { deedId: 'A', sharePpm: 400_000, parValueMojos: '1' },
      ]),
    ).toThrowError(/duplicate/i);
    expect(() =>
      service.validateDeedAllocation([
        { deedId: 'A', sharePpm: 999_999, parValueMojos: '1' },
      ]),
    ).toThrowError(/totals/i);
  });
});

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}
