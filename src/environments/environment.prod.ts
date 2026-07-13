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
    bridgeParentId: '',
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
    adminAuthorityV2LauncherId: '',
    adminAuthorityV2MipsRootHash: '',
    adminAuthorityV2QuorumMode: 'mofn1of1' as 'bare' | 'mofn1of1',
    adminAuthorityV2AdminAddresses: [] as string[],
    protocolConfigLauncherId: '',
    propertyRegistryLauncherId: '',
    poolLauncherId: '',
    governanceLauncherId: '',
    protocolConfigModHash: '',
    propertyRegistryModHash: '',
    mintProposalModHash: '',
    vaultInnerModHash: '',
    /** Vault-version registry singleton. Empty = not deployed yet. */
    vaultVersionRegistryLauncherId: '',
    /** Tree hash of vault_version_registry_inner.clsp. */
    vaultVersionRegistryModHash:
      '0x5cf39809296ad31bf906f7610912ac56fb8c339e0e98444f821f9e363df60d29',
  },
};
