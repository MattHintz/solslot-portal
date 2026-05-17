export const environment = {
  production: true,
  faucetApi: 'https://portal.populis.xyz/api',
  coinsetRpc: 'https://testnet11.api.coinset.org',
  chiaNetwork: 'testnet11' as 'testnet11' | 'mainnet',
  walletConnectProjectId: '',
  eip712ChainId: 1,
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
    poolLauncherId: '',
    governanceLauncherId: '',
    protocolConfigModHash: '',
    propertyRegistryModHash: '',
    mintProposalModHash: '',
    vaultInnerModHash: '',
  },
};
