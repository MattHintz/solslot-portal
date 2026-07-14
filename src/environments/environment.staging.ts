import { environment as devEnvironment } from './environment.shared';

export const environment = {
  ...devEnvironment,
  production: true,
  experienceMode: 'testnet-alpha' as const,
  protocolWritesEnabled: false,
  strictProtocolCoordinatePins: true,
  faucetApi: '/protocol-api',
  legacyRecallApi: '/telonium',
  walletConnectProjectId: devEnvironment.walletConnectProjectId,
};
