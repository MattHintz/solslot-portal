import { environment as ceremony } from './environment.ceremony';

/** Hosted RC28.2 after genesis. Verify the sealed artifact before installing coordinates.
 * Follow-up UI patch provenance is recorded in release.json; the signed source stays frozen.
 */
export const environment = {
  ...ceremony,
  runtimeEnvironment: 'production-testnet',
  zkPassport: {
    ...ceremony.zkPassport,
    domain: 'solslot.com',
    deploymentEnvironment: 'production-alpha' as const,
    devMode: false,
    verificationUrl: '/verify-identity',
    evmRpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  },
  solslotProtocol: {
    ...ceremony.solslotProtocol,
    artifactHash: '0xdd313bf4705dfda7f59e3fb8c24cc1862c6a50994ddd74547eaa30c7727c8140',
    adminPortalSourceSha: '710ea02f18f05f93f5e085a605302b3d540ef9c2',
  },
};
