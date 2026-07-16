import { environment as stagingEnvironment } from './environment.staging';

/**
 * Same-origin, testnet-only build used during the one-shot genesis ceremony.
 * The API still enforces every write lock and administrator signature.
 */
export const environment = {
  ...stagingEnvironment,
  protocolWritesEnabled: true,
};
