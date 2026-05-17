export const A5_ROSTER_UPDATE_AUTHORIZATION_MODEL = {
  spendName: 'ADMIN_ROSTER_UPDATE',
  spendTag: 0x07,
  authorizer: 'current_admin_authority_v2_mips_quorum',
  forbiddenAuthorizers: [
    'candidate_admin_wallet',
    'populis_api_backend',
    'pgt_committee_vote',
    'bootstrap_operator_token',
  ],
  updateRule: 'append_exactly_one_admin_slot',
  thresholdRule: 'supermajority_threshold_over_updated_roster',
  backendRole: 'optional_cross_check_only',
  localReviewGate: 'verify_signer_input_hashes_without_mips_execution',
  verifiedSignerInputs: [
    'current_mips_puzzle_reveal_tree_hash',
    'current_mips_quorum_solution_serialized_clvm_parse_only',
    'current_admin_authority_v2_inner_puzzle_reveal_tree_hash',
    'live_singleton_coin_metadata_and_puzzle_hash',
  ],
  forbiddenReviewActions: [
    'execute_mips',
    'construct_clvm_spends',
    'collect_wallet_signature',
    'sign',
    'broadcast',
    'call_backend',
  ],
  signerBoundary: 'no_signing_no_broadcast_until_local_signer_inputs_are_hash_verified',
} as const;

export const A5_ROSTER_UPDATE_AUTHORIZATION_TEXT = [
  'A.5 roster updates are admin_authority_v2 singleton spends with SPEND_ADMIN_ROSTER_UPDATE = 0x07 and spend_name ADMIN_ROSTER_UPDATE.',
  'The only protocol authorizer for this A.5 add-admin path is the current admin_authority_v2 MIPS quorum committed in current.mips_root_hash.',
  'The candidate admin wallet does not authorize its own addition.',
  'The Populis API backend is optional cross-check infrastructure only and is not an authority source for roster changes.',
  'PGT committee approval is not part of this A.5 add-admin path unless a future governance design explicitly adds a separate spend path.',
  'The bootstrap operator token cannot authorize post-genesis roster updates.',
  'Each A.5 roster update appends exactly one admin slot, preserves existing admin records as a prefix, preserves pending_ops_hash, and increments authority_version by one.',
  'The post-update MIPS root is recomputed from the updated roster using the admin supermajority threshold.',
  'The review screen locally verifies signer input hashes before any future spend builder: current MIPS puzzle reveal tree hash must match current.mips_root_hash, the current MIPS quorum solution must parse as serialized CLVM without being executed, the current admin_authority_v2 inner puzzle reveal tree hash must match the recomputed current inner puzzle hash, and live singleton coin metadata plus puzzle hash must match the package.',
  'The unsigned package and review screen remain no-signing and no-broadcast boundaries until current MIPS puzzle reveal, current MIPS quorum solution, live singleton coin, and wallet spend-bundle signature inputs are supplied and hash-verified.',
  'Local hash verification does not execute MIPS, construct CLVM spends, collect wallet signatures, sign, broadcast, or call the backend.',
] as const;
