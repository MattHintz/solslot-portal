import { environment as base } from './environment.shared';

/** Mainnet protocol writes stay disabled until a separate mainnet V2 ceremony. */
export const environment = {
  ...base,
  production: true,
  experienceMode: 'mainnet-beta-preview' as const,
  protocolWritesEnabled: false,
  faucetApi: '/protocol-api',
  legacyRecallApi: 'https://solslot.com/telonium',
  coinsetRpc: 'https://api.coinset.org',
  chiaNetwork: 'mainnet' as const,
  walletConnectProjectId: '',
  zkPassport: {
    ...base.zkPassport,
    verificationUrl: '',
    devMode: false,
  },
};
