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
      '0xb18c4ee267b174b334efc836c3f10e535add1839fe13bf9cf1bc42f1f1e4b157',
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
  },
};
