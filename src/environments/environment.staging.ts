import { environment as devEnvironment } from './environment.shared';

export const environment = {
  ...devEnvironment,
  production: true,
  runtimeEnvironment: 'staging',
  experienceMode: 'testnet-alpha' as const,
  protocolWritesEnabled: false,
  strictProtocolCoordinatePins: true,
  faucetApi: '/protocol-api',
  legacyRecallApi: '/telonium',
  coinsetRpc: '/protocol-api/chia',
  walletConnectProjectId: devEnvironment.walletConnectProjectId,
};
