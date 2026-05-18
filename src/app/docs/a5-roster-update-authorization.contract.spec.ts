import {
  A5_ROSTER_UPDATE_AUTHORIZATION_MODEL,
  A5_ROSTER_UPDATE_AUTHORIZATION_TEXT,
  A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT,
  A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT,
  A5_ROSTER_UPDATE_UNSIGNED_CLVM_CONSTRUCTION_CONTRACT,
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

  it('pins unsigned CLVM construction as plan-only without coin spend serialization', () => {
    expect(A5_ROSTER_UPDATE_UNSIGNED_CLVM_CONSTRUCTION_CONTRACT.boundary).toBe(
      'derive_unsigned_clvm_construction_plan_without_coin_spend_serialization',
    );
    expect(A5_ROSTER_UPDATE_UNSIGNED_CLVM_CONSTRUCTION_CONTRACT.result).toBe(
      'unsigned_clvm_construction_plan_only_no_coin_spends',
    );
    expect(A5_ROSTER_UPDATE_UNSIGNED_CLVM_CONSTRUCTION_CONTRACT.requiredInputs).toEqual([
      'verified_spend_builder_intake',
      'raw_current_mips_puzzle_reveal',
      'raw_current_mips_quorum_solution',
      'raw_current_admin_authority_v2_inner_puzzle_reveal',
      'live_singleton_coin_metadata',
    ]);
    expect(A5_ROSTER_UPDATE_UNSIGNED_CLVM_CONSTRUCTION_CONTRACT.requiredRechecks).toEqual([
      'verified_intake_result_is_verified_intake_only_no_signed_bundle',
      'raw_material_hashes_match_verified_intake_commitments',
      'live_singleton_coin_matches_verified_intake',
      'current_state_commitments_match_verified_intake',
      'singleton_full_puzzle_hash_matches_live_coin_puzzle_hash',
    ]);
    expect(A5_ROSTER_UPDATE_UNSIGNED_CLVM_CONSTRUCTION_CONTRACT.allowedOutputs).toEqual([
      'unsigned_admin_authority_v2_spend_shape',
      'unsigned_mips_spend_shape',
      'expected_conditions_summary',
      'deterministic_unsigned_construction_summary',
    ]);
    expect(text).toContain('unsigned CLVM construction boundary may derive unsigned admin_authority_v2 and MIPS spend shapes');
    expect(text).toContain('from a verified spend-builder intake without serializing coin spends');
    expect(text).toContain('verified intake result is verified_intake_only_no_signed_bundle');
  });

  it('keeps unsigned CLVM construction outside execution, signatures, broadcast, backend, and raw output', () => {
    expect(A5_ROSTER_UPDATE_UNSIGNED_CLVM_CONSTRUCTION_CONTRACT.forbiddenActions).toEqual([
      'execute_mips',
      'serialize_coin_spends',
      'collect_wallet_signature',
      'sign',
      'broadcast',
      'call_backend',
    ]);
    expect(A5_ROSTER_UPDATE_UNSIGNED_CLVM_CONSTRUCTION_CONTRACT.forbiddenMaterial).toEqual([
      'raw_reveal_bytes_in_output',
      'wallet_signature',
      'signed_spend_bundle',
      'api_credentials',
      'jwt',
      'nonce',
      'secret',
    ]);
    expect(text).toContain('must not execute MIPS, serialize coin spends, collect wallet signatures, sign, broadcast, call the backend');
    expect(text).toContain('output raw reveal bytes');
    expect(text).toContain('wallet signatures, signed spend bundles, API credentials, JWTs, nonces, or secrets');
  });

  it('pins MIPS execution and unsigned CoinSpend serialization without signatures or broadcast', () => {
    expect(A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.boundary).toBe(
      'execute_mips_and_serialize_unsigned_coin_spends_without_signing_or_broadcast',
    );
    expect(A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.result).toBe(
      'unsigned_coin_spend_candidate_only_no_signatures',
    );
    expect(A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.requiredInputs).toEqual([
      'unsigned_clvm_construction_plan',
      'verified_spend_builder_intake',
      'raw_current_mips_puzzle_reveal',
      'raw_current_mips_quorum_solution',
      'raw_current_admin_authority_v2_inner_puzzle_reveal',
      'live_singleton_coin_metadata',
      'current_admin_records',
      'current_pending_ops',
      'new_admin_record',
      'singleton_lineage_proof',
    ]);
    expect(A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.requiredRechecks).toEqual([
      'unsigned_clvm_plan_result_is_unsigned_clvm_construction_plan_only_no_coin_spends',
      'verified_intake_result_is_verified_intake_only_no_signed_bundle',
      'raw_material_hashes_match_plan_and_intake_commitments',
      'admin_and_pending_records_hash_to_committed_state',
      'singleton_lineage_proof_is_supplied_for_unsigned_coin_spend_solution',
      'mips_execution_cost_within_limit',
      'mips_execution_conditions_match_expected_roster_update',
      'serialized_unsigned_coin_spends_match_plan_shapes',
      'serialized_unsigned_coin_spends_contain_no_signatures',
    ]);
    expect(A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.allowedMaterial).toEqual([
      'raw_reveal_bytes_inside_unsigned_coin_spend_puzzle_reveal_only',
      'raw_solution_bytes_inside_unsigned_coin_spend_solution_only',
    ]);
    expect(A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.allowedOutputs).toEqual([
      'bounded_mips_execution_report',
      'unsigned_admin_authority_v2_coin_spend',
      'embedded_mips_authorization_payload',
      'unsigned_spend_bundle_candidate',
      'deterministic_pre_signing_review',
    ]);
    expect(text).toContain('may execute the current MIPS authorization path under explicit cost limits');
    expect(text).toContain('serialize an unsigned admin_authority_v2 CoinSpend candidate');
    expect(text).toContain('full admin records plus pending ops hash to the committed state');
    expect(text).toContain('singleton lineage proof is supplied');
    expect(text).toContain('Raw reveal and solution bytes may appear only inside unsigned CoinSpend puzzle_reveal and solution fields');
  });

  it('keeps MIPS execution and unsigned CoinSpend serialization outside signatures, broadcast, and credentials', () => {
    expect(A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.forbiddenActions).toEqual([
      'collect_wallet_signature',
      'sign',
      'broadcast',
      'call_backend_as_roster_authority',
    ]);
    expect(A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.forbiddenMaterial).toEqual([
      'wallet_signature',
      'aggregated_signature',
      'signed_spend_bundle',
      'api_credentials',
      'jwt',
      'nonce',
      'secret',
      'private_key',
    ]);
    expect(text).toContain('must not collect wallet signatures, sign, broadcast, treat the backend as roster authority');
    expect(text).toContain('wallet signatures, aggregated signatures, signed spend bundles, API credentials, JWTs, nonces, secrets, or private keys');
  });
});
