import {
  A5_ROSTER_UPDATE_AUTHORIZATION_MODEL,
  A5_ROSTER_UPDATE_AUTHORIZATION_TEXT,
  A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT,
} from './a5-roster-update-authorization.contract';

describe('A.5 roster update authorization contract', () => {
  const text = A5_ROSTER_UPDATE_AUTHORIZATION_TEXT.join('\n');

  it('pins the spend as a current admin-authority MIPS quorum path', () => {
    expect(A5_ROSTER_UPDATE_AUTHORIZATION_MODEL.spendName).toBe('ADMIN_ROSTER_UPDATE');
    expect(A5_ROSTER_UPDATE_AUTHORIZATION_MODEL.spendTag).toBe(0x07);
    expect(A5_ROSTER_UPDATE_AUTHORIZATION_MODEL.authorizer).toBe(
      'current_admin_authority_v2_mips_quorum',
    );
    expect(text).toContain('SPEND_ADMIN_ROSTER_UPDATE = 0x07');
    expect(text).toContain('current admin_authority_v2 MIPS quorum');
    expect(text).toContain('current.mips_root_hash');
  });

  it('pins candidate, backend, committee, and bootstrap token as non-authorizers', () => {
    expect(A5_ROSTER_UPDATE_AUTHORIZATION_MODEL.forbiddenAuthorizers).toEqual([
      'candidate_admin_wallet',
      'populis_api_backend',
      'pgt_committee_vote',
      'bootstrap_operator_token',
    ]);
    expect(text).toContain('candidate admin wallet does not authorize its own addition');
    expect(text).toContain('Populis API backend is optional cross-check infrastructure only');
    expect(text).toContain('PGT committee approval is not part of this A.5 add-admin path');
    expect(text).toContain('bootstrap operator token cannot authorize post-genesis roster updates');
  });

  it('pins append-only roster mutation and updated-roster supermajority semantics', () => {
    expect(A5_ROSTER_UPDATE_AUTHORIZATION_MODEL.updateRule).toBe('append_exactly_one_admin_slot');
    expect(A5_ROSTER_UPDATE_AUTHORIZATION_MODEL.thresholdRule).toBe(
      'supermajority_threshold_over_updated_roster',
    );
    expect(text).toContain('appends exactly one admin slot');
    expect(text).toContain('preserves existing admin records as a prefix');
    expect(text).toContain('preserves pending_ops_hash');
    expect(text).toContain('increments authority_version by one');
    expect(text).toContain('post-update MIPS root is recomputed');
    expect(text).toContain('admin supermajority threshold');
  });

  it('pins unsigned package and review screens as no-signing/no-broadcast boundaries', () => {
    expect(A5_ROSTER_UPDATE_AUTHORIZATION_MODEL.backendRole).toBe('optional_cross_check_only');
    expect(A5_ROSTER_UPDATE_AUTHORIZATION_MODEL.signerBoundary).toBe(
      'no_signing_no_broadcast_until_local_signer_inputs_are_hash_verified',
    );
    expect(text).toContain('no-signing and no-broadcast boundaries');
    expect(text).toContain('current MIPS puzzle reveal');
    expect(text).toContain('current MIPS quorum solution');
    expect(text).toContain('live singleton coin');
    expect(text).toContain('wallet spend-bundle signature');
  });

  it('pins local signer input hash verification without entering spend execution', () => {
    expect(A5_ROSTER_UPDATE_AUTHORIZATION_MODEL.localReviewGate).toBe(
      'verify_signer_input_hashes_without_mips_execution',
    );
    expect(A5_ROSTER_UPDATE_AUTHORIZATION_MODEL.verifiedSignerInputs).toEqual([
      'current_mips_puzzle_reveal_tree_hash',
      'current_mips_quorum_solution_serialized_clvm_parse_only',
      'current_admin_authority_v2_inner_puzzle_reveal_tree_hash',
      'live_singleton_coin_metadata_and_puzzle_hash',
    ]);
    expect(A5_ROSTER_UPDATE_AUTHORIZATION_MODEL.forbiddenReviewActions).toEqual([
      'execute_mips',
      'construct_clvm_spends',
      'collect_wallet_signature',
      'sign',
      'broadcast',
      'call_backend',
    ]);
    expect(text).toContain('current MIPS puzzle reveal tree hash must match current.mips_root_hash');
    expect(text).toContain('current MIPS quorum solution must parse as serialized CLVM without being executed');
    expect(text).toContain('inner puzzle reveal tree hash must match the recomputed current inner puzzle hash');
    expect(text).toContain('live singleton coin metadata plus puzzle hash must match the package');
    expect(text).toContain('does not execute MIPS, construct CLVM spends, collect wallet signatures, sign, broadcast, or call the backend');
  });

  it('pins spend-builder intake as normalize-and-reverify only', () => {
    expect(A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT.boundary).toBe(
      'normalize_and_reverify_inputs_without_spend_construction',
    );
    expect(A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT.result).toBe(
      'verified_intake_only_no_signed_bundle',
    );
    expect(A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT.requiredInputs).toEqual([
      'local_unsigned_spend_blueprint',
      'local_verification_report',
      'raw_current_mips_puzzle_reveal',
      'raw_current_mips_quorum_solution',
      'raw_current_admin_authority_v2_inner_puzzle_reveal',
      'live_singleton_coin_metadata',
    ]);
    expect(A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT.requiredRechecks).toEqual([
      'blueprint_matches_verification_report',
      'raw_reveals_match_verified_commitment_hashes',
      'live_singleton_coin_id_matches_parent_puzzle_hash_amount',
      'current_inner_puzzle_hash_matches_current_state_commitment',
      'singleton_full_puzzle_hash_matches_live_coin_puzzle_hash',
    ]);
    expect(text).toContain('spend-builder intake boundary may normalize and reverify');
    expect(text).toContain('raw current admin_authority_v2 inner puzzle reveal');
    expect(text).toContain('blueprint commitments match the verification report');
    expect(text).toContain('singleton full puzzle hash matches the live coin puzzle hash');
  });

  it('keeps spend-builder intake outside signing, backend, and broadcast material', () => {
    expect(A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT.allowedOutputs).toEqual([
      'normalized_spend_builder_intake',
      'deterministic_commitment_summary',
      'unsigned_construction_plan',
    ]);
    expect(A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT.forbiddenActions).toEqual([
      'execute_mips',
      'construct_clvm_spends',
      'collect_wallet_signature',
      'sign',
      'broadcast',
      'call_backend',
    ]);
    expect(A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT.forbiddenMaterial).toEqual([
      'wallet_signature',
      'signed_spend_bundle',
      'api_credentials',
      'jwt',
      'nonce',
      'secret',
    ]);
    expect(text).toContain('may only output a normalized intake, deterministic commitment summary, or unsigned construction plan');
    expect(text).toContain('must not execute MIPS, construct CLVM spends, collect wallet signatures, sign, broadcast, call the backend');
    expect(text).toContain('wallet signatures, signed spend bundles, API credentials, JWTs, nonces, or secrets');
  });
});
