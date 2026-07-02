/**
 * Compiled bytecode of `purchase_payment.clsp` (Phase 4 mint-publish).
 *
 * Bundled at build time from
 * ``populis_protocol/populis_puzzles/purchase_payment.clsp.hex``
 * via the helper script
 * ``populis_protocol/scripts/dump_mint_publish_puzzle_hex.sh``.
 *
 * Purpose: ephemeral buyer-side payment coin spawned during mint-offer settlement (only its mod hash is curried into the eve mint-offer inner — needed here so the TS service can independently derive that hash without trusting the fixture)
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
export const PURCHASE_PAYMENT_PUZZLE_HEX =
  '0x' +
  'ff02ffff01ff02ffff03ffff09ffff0dff1780ffff012080ffff01ff02ffff03ffff02ff2effff04ff02ffff04ff2fff80808080ffff01ff02ffff03ffff02ff2effff04ff02ffff04ff05ff80808080ffff01ff02ffff03ffff15ff05ff8080ffff01ff02ffff03ffff02ff16ffff04ff02ffff04ff2fffff04ff05ff8080808080ffff01ff02ffff03ffff15ff2fff0580ffff01ff02ff1affff04ff02ffff04ff05ffff04ff0bffff04ff17ffff04ff2fff80808080808080ffff01ff02ff12ffff04ff02ffff04ff05ffff04ff0bffff04ff2fff80808080808080ff0180ffff01ff088080ff0180ffff01ff088080ff0180ffff01ff088080ff0180ffff01ff088080ff0180ffff01ff088080ff0180ffff04ffff01ffffff4933ff50ff845055524342ffffff04ffff04ff18ffff04ff0bffff04ff05ffff04ffff04ff0bff8080ff8080808080ffff04ffff04ff3cffff04ffff0110ffff04ffff0eff14ffff02ff3effff04ff02ffff04ffff04ff2cffff04ff05ffff04ff0bff80808080ff8080808080ff80808080ffff04ffff04ff10ffff04ff17ff808080ff80808080ff04ffff04ff18ffff04ff17ffff04ffff11ff2fff0580ffff04ffff04ff17ff8080ff8080808080ffff02ff12ffff04ff02ffff04ff05ffff04ff0bffff04ff2fff80808080808080ffff20ffff15ff0bff058080ffff02ffff03ffff15ff80ff0580ff80ffff01ff02ffff03ffff20ffff15ffff0189010000000000000000ff058080ff80ffff01ff09ffff10ff0580ff058080ff018080ff0180ff02ffff03ffff07ff0580ffff01ff0bffff0102ffff02ff3effff04ff02ffff04ff09ff80808080ffff02ff3effff04ff02ffff04ff0dff8080808080ffff01ff0bffff0101ff058080ff0180ff018080';
