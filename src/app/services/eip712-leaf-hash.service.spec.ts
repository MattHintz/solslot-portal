import { TestBed } from '@angular/core/testing';

import { ChiaWasmService } from './chia-wasm.service';
import {
  Eip712LeafHashService,
  TESTNET11_GENESIS_CHALLENGE_HEX,
  MAINNET_GENESIS_CHALLENGE_HEX,
  genesisChallengeFor,
} from './eip712-leaf-hash.service';

/**
 * Karma tests for the WASM-backed Eip712Member leaf-hash service.
 *
 * The fixture values pinned here are computed by
 * ``populis_protocol/populis_puzzles/eip712_helpers.py``'s
 * ``compute_eip712_member_leaf_hash`` (which uses
 * ``chia.wallet.util.curry_and_treehash`` semantics) and
 * cross-verified against ``Program.curry().get_tree_hash()`` —
 * see ``test_matches_chia_curry_and_treehash`` in
 * ``populis_protocol/tests/test_eip712_helpers.py``.
 *
 * If you bump the chia-wallet-sdk-wasm package and this test fails,
 * regenerate the fixtures by running:
 *
 *     cd populis_protocol && .venv/bin/python -c "
 *     from populis_puzzles.eip712_helpers import (
 *         compute_eip712_member_leaf_hash,
 *         eip712_prefix_and_domain_separator,
 *         genesis_challenge_for_network,
 *     )
 *     for network in ['testnet11', 'mainnet']:
 *         genesis = genesis_challenge_for_network(network)
 *         prefix = eip712_prefix_and_domain_separator(genesis)
 *         pubkey = bytes.fromhex(
 *             '0217bf27e0523f4ab9898dd87344f70b5231266e9e63da9fd401f8b4443e3d3e68'
 *         )
 *         leaf = compute_eip712_member_leaf_hash(
 *             secp256k1_pubkey=pubkey,
 *             prefix_and_domain_separator=prefix,
 *         )
 *         print(network, '0x' + leaf.hex())
 *     "
 *
 * — and copy each network's hash into the corresponding ``EXPECTED_*``
 * constant below.
 */

// ──────────────────────────────────────────────────────────────────────
// Pinned fixtures (Python reference values).
// ──────────────────────────────────────────────────────────────────────

/** A real compressed secp256k1 pubkey (recovered from a valid EIP-712
 * signature — same one used in the populis_protocol test suite). */
const FIXTURE_PUBKEY =
  '0x0217bf27e0523f4ab9898dd87344f70b5231266e9e63da9fd401f8b4443e3d3e68';

/** Expected leaf hash on testnet11 — matches Python helper output. */
const EXPECTED_LEAF_TESTNET11 =
  '0xe8c2baeef110fa6ab11524950e23853db4d74740197c7a56fe2999418e4b5b1f';

/** Expected leaf hash on mainnet — same pubkey, different domain
 *  separator → different leaf hash (network-binding sanity check). */
const EXPECTED_LEAF_MAINNET =
  '0x31cdde429247464052448166bbcedaa06192843ebea865a03574899e35ff86e9';

/** Expected CHIP-0037 type hash (network-independent constant). */
const EXPECTED_TYPE_HASH =
  '0x72930978f119c79f9de7a13bd50c9b3261132d7b4819bdf0d3ca4d4c37ade070';

/** Expected 0x1901-prefixed domain separator for testnet11. */
const EXPECTED_PREFIX_AND_DOMAIN_TESTNET11 =
  '0x1901d7ae6e3495da146db31eab08f5d6000510a326c3c9ac3c072f770d013c0f2d32';

describe('Eip712LeafHashService', () => {
  let service: Eip712LeafHashService;

  beforeAll(async () => {
    // Reuse the same WASM bootstrap as
    // ``admin-authority-v2.service.spec.ts`` — fetch the .wasm asset,
    // hand-instantiate, and stash on ``window.ChiaSDK``.  We guard on
    // an existing ``window.ChiaSDK`` so the wasm is only instantiated
    // once across the karma session: re-running ``__wbg_set_wasm`` with
    // a second instance breaks any references the first instance owns
    // (the bg.js module is a singleton across imports, so subsequent
    // calls to it would reach for the new wasm's memory and corrupt
    // state allocated against the first one).
    if ((window as unknown as { ChiaSDK?: unknown }).ChiaSDK) {
      return;
    }
    // @ts-ignore — deep-import path.
    const wasmExports = await import('chia-wallet-sdk-wasm/chia_wallet_sdk_wasm_bg.js');
    const response = await fetch('/assets/chia_wasm/chia_wallet_sdk_wasm_bg.wasm');
    if (!response.ok) {
      throw new Error(
        `WASM asset fetch failed: ${response.status} ${response.statusText}`,
      );
    }
    const bytes = await response.arrayBuffer();
    const result = await WebAssembly.instantiate(bytes, {
      './chia_wallet_sdk_wasm_bg.js': wasmExports as unknown as WebAssembly.ModuleImports,
    });

    const setWasm = (
      wasmExports as unknown as { __wbg_set_wasm?: (w: WebAssembly.Exports) => void }
    ).__wbg_set_wasm;
    if (typeof setWasm !== 'function') {
      throw new Error('chia_wallet_sdk_wasm_bg.js missing __wbg_set_wasm');
    }
    setWasm(result.instance.exports);

    (window as unknown as { ChiaSDK: unknown }).ChiaSDK = wasmExports;
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    const wasmService = TestBed.inject(ChiaWasmService);
    wasmService.probeReady();
    service = TestBed.inject(Eip712LeafHashService);
  });

  describe('genesis challenge constants', () => {
    it('TESTNET11_GENESIS_CHALLENGE_HEX matches populis_protocol pin', () => {
      expect(TESTNET11_GENESIS_CHALLENGE_HEX).toBe(
        '37a90eb5185a9c4439a91ddc98bbadce7b4feba060d50116a067de66bf236615',
      );
    });

    it('MAINNET_GENESIS_CHALLENGE_HEX matches populis_protocol pin', () => {
      expect(MAINNET_GENESIS_CHALLENGE_HEX).toBe(
        'ccd5bb71183532bff220ba46c268991a3ff07eb358e8255a65c30a2dce0e5fbb',
      );
    });

    it('genesisChallengeFor produces 32-byte arrays', () => {
      expect(genesisChallengeFor('testnet11').length).toBe(32);
      expect(genesisChallengeFor('mainnet').length).toBe(32);
    });
  });

  describe('compute', () => {
    it('matches the Python reference leaf hash on testnet11', () => {
      const result = service.compute(FIXTURE_PUBKEY, 'testnet11');
      expect(result.leaf_hash).toBe(EXPECTED_LEAF_TESTNET11);
      expect(result.network).toBe('testnet11');
      expect(result.secp256k1_pubkey).toBe(FIXTURE_PUBKEY);
    });

    it('matches the Python reference leaf hash on mainnet', () => {
      const result = service.compute(FIXTURE_PUBKEY, 'mainnet');
      expect(result.leaf_hash).toBe(EXPECTED_LEAF_MAINNET);
      expect(result.network).toBe('mainnet');
    });

    it('emits the canonical CHIP-0037 type_hash (network-independent)', () => {
      const t11 = service.compute(FIXTURE_PUBKEY, 'testnet11');
      const main = service.compute(FIXTURE_PUBKEY, 'mainnet');
      expect(t11.type_hash).toBe(EXPECTED_TYPE_HASH);
      expect(main.type_hash).toBe(EXPECTED_TYPE_HASH);
    });

    it('builds the correct 34-byte 0x1901-prefixed domain on testnet11', () => {
      const result = service.compute(FIXTURE_PUBKEY, 'testnet11');
      expect(result.prefix_and_domain_separator).toBe(
        EXPECTED_PREFIX_AND_DOMAIN_TESTNET11,
      );
      // The 34 bytes break down as 0x1901 || 32-byte domain separator.
      const bytes = hexToBytes(result.prefix_and_domain_separator);
      expect(bytes.length).toBe(34);
      expect(bytes[0]).toBe(0x19);
      expect(bytes[1]).toBe(0x01);
    });

    it('produces different leaf hashes for different pubkeys', () => {
      const a = service.compute(FIXTURE_PUBKEY, 'testnet11');
      const b = service.compute(
        '0x03' + 'aa'.repeat(32),
        'testnet11',
      );
      expect(a.leaf_hash).not.toBe(b.leaf_hash);
    });

    it('produces different leaf hashes for the same pubkey on different networks', () => {
      const t11 = service.compute(FIXTURE_PUBKEY, 'testnet11');
      const main = service.compute(FIXTURE_PUBKEY, 'mainnet');
      expect(t11.leaf_hash).not.toBe(main.leaf_hash);
    });

    it('rejects pubkeys that are not 33 bytes', () => {
      expect(() =>
        service.compute('0x02' + 'aa'.repeat(31), 'testnet11'),
      ).toThrowError(/33 bytes/);
    });

    it('accepts pubkeys with or without 0x prefix', () => {
      const withPrefix = service.compute(FIXTURE_PUBKEY, 'testnet11');
      const withoutPrefix = service.compute(
        FIXTURE_PUBKEY.slice(2),
        'testnet11',
      );
      expect(withPrefix.leaf_hash).toBe(withoutPrefix.leaf_hash);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // MIPS root computation (1-of-1 controller).
  //
  // These tests exercise the new ``computeMipsRoot1Of1`` helper that
  // wraps an EIP-712 admin into a CHIP-0043 ``m_of_n`` quorum tree
  // entirely in-browser via WASM (using the ``mOfNHash`` +
  // ``eip712MemberHash`` + ``MemberConfig`` bindings landed in chia-
  // wallet-sdk PR #396).
  //
  // The ``bare`` mode is mechanically equal to ``compute().leaf_hash``
  // (degenerate "MIPS root = bare member") so it has a tight invariant
  // we can pin precisely.  The ``mofn1of1`` mode produces a different
  // hash (real wrapped quorum) and we pin it loosely (different from
  // bare, deterministic, byte-shaped) — the absolute value depends on
  // wasm-bindgen serialization details we don't want to over-couple to.
  // ────────────────────────────────────────────────────────────────────

  describe('computeMipsRoot1Of1', () => {
    it('bare mode returns the same hash as compute().leaf_hash', () => {
      const leaf = service.compute(FIXTURE_PUBKEY, 'testnet11');
      const root = service.computeMipsRoot1Of1(
        FIXTURE_PUBKEY,
        'testnet11',
        'bare',
      );
      expect(root.shape).toBe('bare');
      expect(root.mips_root_hash).toBe(leaf.leaf_hash);
    });

    it('mofn1of1 mode returns a hash distinct from bare', () => {
      const bare = service.computeMipsRoot1Of1(
        FIXTURE_PUBKEY,
        'testnet11',
        'bare',
      );
      const wrapped = service.computeMipsRoot1Of1(
        FIXTURE_PUBKEY,
        'testnet11',
        'mofn1of1',
      );
      expect(wrapped.shape).toBe('mofn1of1');
      expect(wrapped.mips_root_hash.length).toBe(2 + 64);  // 0x + 32 bytes
      expect(wrapped.mips_root_hash).not.toBe(bare.mips_root_hash);
    });

    it('mofn1of1 mode is deterministic across calls', () => {
      const a = service.computeMipsRoot1Of1(
        FIXTURE_PUBKEY,
        'testnet11',
        'mofn1of1',
      );
      const b = service.computeMipsRoot1Of1(
        FIXTURE_PUBKEY,
        'testnet11',
        'mofn1of1',
      );
      expect(a.mips_root_hash).toBe(b.mips_root_hash);
    });

    it('mofn1of1 mode produces different hashes on different networks', () => {
      const t11 = service.computeMipsRoot1Of1(
        FIXTURE_PUBKEY,
        'testnet11',
        'mofn1of1',
      );
      const main = service.computeMipsRoot1Of1(
        FIXTURE_PUBKEY,
        'mainnet',
        'mofn1of1',
      );
      expect(t11.mips_root_hash).not.toBe(main.mips_root_hash);
    });

    it('mofn1of1 mode produces different hashes for different pubkeys', () => {
      const a = service.computeMipsRoot1Of1(
        FIXTURE_PUBKEY,
        'testnet11',
        'mofn1of1',
      );
      const b = service.computeMipsRoot1Of1(
        '0x03' + 'aa'.repeat(32),
        'testnet11',
        'mofn1of1',
      );
      expect(a.mips_root_hash).not.toBe(b.mips_root_hash);
    });

    it('default mode is mofn1of1 (production-shaped)', () => {
      const explicit = service.computeMipsRoot1Of1(
        FIXTURE_PUBKEY,
        'testnet11',
        'mofn1of1',
      );
      const defaulted = service.computeMipsRoot1Of1(FIXTURE_PUBKEY, 'testnet11');
      expect(defaulted.shape).toBe('mofn1of1');
      expect(defaulted.mips_root_hash).toBe(explicit.mips_root_hash);
    });

    it('rejects pubkeys that are not 33 bytes', () => {
      expect(() =>
        service.computeMipsRoot1Of1(
          '0x02' + 'aa'.repeat(31),
          'testnet11',
          'mofn1of1',
        ),
      ).toThrowError(/33 bytes/);
    });
  });
});

function hexToBytes(hex: string): Uint8Array {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < stripped.length; i += 2) {
    out[i / 2] = parseInt(stripped.slice(i, i + 2), 16);
  }
  return out;
}
