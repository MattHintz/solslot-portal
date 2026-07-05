import { environment as devEnvironment } from './environment.shared';

export const environment = {
  ...devEnvironment,
  production: true,
  faucetApi: '/protocol-api',
  legacyRecallApi: '/telonium',
  walletConnectProjectId: devEnvironment.walletConnectProjectId,
};
