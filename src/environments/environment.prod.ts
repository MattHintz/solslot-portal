export const environment = {
  production: true,
  faucetApi: 'https://portal.populis.xyz/api',
  coinsetRpc: 'https://testnet11.api.coinset.org',
  chiaNetwork: 'testnet11' as 'testnet11' | 'mainnet',
  walletConnectProjectId: '',
  eip712ChainId: 84532,
  zkPassport: {
    verificationUrl: '',
    evmRpcUrl: '',
    attestationEmitterAddress: '',
    attestationEmitterFromBlock: 0,
    evmPollTimeoutMs: 120_000,
    bridgeParentId: '0x0000000000000000000000000000000000000000000000000000000000000000',
    bridgeAmount: 1,
    validatorPubkeys: [] as string[],
    validatorThreshold: 0,
    devMode: false,
  },
  /**
   * On-chain singleton coordinates.  See environment.ts for full
   * documentation; mirror the same shape so prod builds compile.
   * Update launcher_ids to match the operator's mainnet deployment
   * before flipping ``chiaNetwork`` to ``'mainnet'``.
   */
  populisProtocol: {
    adminAuthorityLauncherId: '',
    adminAuthorityV2LauncherId:
      '0xf3fd2dedfc77a5b8f65acdfaff04d3786844a8c4d0529d3dbc4d37dc4012bb84',
    adminAuthorityV2MipsRootHash:
      '0x95cbfe1c977e0c82ccbc539fa25c295eff23af25900d4e8d9e9ff2eed35a15fe',
    adminAuthorityV2QuorumMode: 'mofn1of1' as 'bare' | 'mofn1of1',
    adminAuthorityV2AdminAddresses: [] as string[],
    protocolConfigLauncherId: '',
    propertyRegistryLauncherId: '',
    propertyRegistryGovPubkey: '',
    collectionNavRegistryLauncherId: '',
    poolLauncherId: '',
    governanceLauncherId: '',
    governanceQuorumBps: 5000,
    governanceVotingWindowSeconds: 300,
    governancePgtTotalSupply: 1_000_000,
    governanceMinProposalStake: 10_000,
    pgtTailGenesisCoinId: '',
    protocolConfigModHash: '',
    propertyRegistryModHash: '',
    mintProposalModHash: '',
    vaultInnerModHash: '',
    /** Vault-version registry singleton. Empty = not deployed yet. */
    vaultVersionRegistryLauncherId: '',
    /** Tree hash of vault_version_registry_inner.clsp. */
    vaultVersionRegistryModHash:
      '0x5cf39809296ad31bf906f7610912ac56fb8c339e0e98444f821f9e363df60d29',

    // ── Mint-publish protocol context (Phase 4f) ───────────────────────
    // See environment.ts for full documentation.  Mirror the API's
    // POPULIS_PROTOCOL_DID_SINGLETON_STRUCT_HEX / POPULIS_PROTOCOL_DID_PUZHASH
    // / POPULIS_P2_POOL_MOD_HASH / POPULIS_P2_VAULT_MOD_HASH before
    // enabling the mint-publish flow on mainnet.
    protocolDidSingletonStructHex: '',
    protocolDidPuzhash: '',
    p2PoolModHash: '',
    p2VaultModHash: '',
    propertyRegistryCurrentPuzzleHash: '',
  },
};
