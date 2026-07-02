/**
 * Compiled bytecode of `singleton_launcher_with_did.clsp` (Phase 4 mint-publish).
 *
 * Bundled at build time from
 * ``populis_protocol/populis_puzzles/singleton_launcher_with_did.clsp.hex``
 * via the helper script
 * ``populis_protocol/scripts/dump_mint_publish_puzzle_hex.sh``.
 *
 * Purpose: DID-gated singleton launcher used by the deed to constrain its launch authorisation to the protocol DID singleton lineage
 *
 * The portal feeds this hex into ``Clvm.deserialize()`` (chia-wallet-sdk-wasm)
 * to construct the puzzle Program client-side.  No API call needed.
 *
 * **CRITICAL**: this constant MUST stay in sync with the .hex file in
 * populis_protocol.  The cross-repo Karma spec
 * ``mint-publish.service.spec.ts`` reads the canonical fixture
 * emitted by ``populis_protocol/scripts/dump_mint_publish_fixtures.py``
 * and asserts byte-equivalence — drift here surfaces there.
 *
 * If the puzzle source changes, regenerate via:
 *
 *     cd populis_protocol
 *     bash scripts/dump_mint_publish_puzzle_hex.sh
 *
 * which rewrites this file.
 */
export const SINGLETON_LAUNCHER_WITH_DID_PUZZLE_HEX =
  '0x' +
  'ff02ffff01ff04ffff04ff18ffff04ff17ffff04ff2fff80808080ffff04ffff04ff14ffff04ffff02ff3effff04ff02ffff04ffff04ff0bffff04ff17ffff04ff2fffff04ff5fff8080808080ff80808080ff808080ffff04ffff04ffff0101ffff04ffff04ff0bffff04ffff02ff16ffff04ff02ffff04ff09ffff04ffff02ff3effff04ff02ffff04ff05ff80808080ffff04ff0bff808080808080ff808080ff808080ffff04ffff04ff10ffff04ffff0bffff02ff16ffff04ff02ffff04ff09ffff04ffff02ff3effff04ff02ffff04ff05ff80808080ffff04ff0bff808080808080ff1780ff808080ff8080808080ffff04ffff01ffffff3f33ff3c02ffffff02ffff03ff05ffff01ff0bff7affff02ff2effff04ff02ffff04ff09ffff04ffff02ff12ffff04ff02ffff04ff0dff80808080ff808080808080ffff016a80ff0180ffffa04bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459aa09dcf97a184f32623d11a73124ceb99a5709b083721e878a16d78f596718ba7b2ffa102a12871fee210fb8619291eaea194581cbd2531e4b23759d225f6806923f63222a102a8d5dd63fba471ebcb1f3e8f7c1e1879b7152a6e7298a91ce119a63400ade7c5ffff0bff5affff02ff2effff04ff02ffff04ff05ffff04ffff02ff12ffff04ff02ffff04ff07ff80808080ff808080808080ffff0bff1cffff0bff1cff6aff0580ffff0bff1cff0bff4a8080ff02ffff03ffff07ff0580ffff01ff0bffff0102ffff02ff3effff04ff02ffff04ff09ff80808080ffff02ff3effff04ff02ffff04ff0dff8080808080ffff01ff0bffff0101ff058080ff0180ff018080';
