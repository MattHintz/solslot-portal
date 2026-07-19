import { environment as ceremonyEnvironment } from './environment.ceremony';

/**
 * Production-hosted ceremony desk. The UI remains available for preparation
 * and review, while protocol writes stay locked until a separate release gate.
 */
export const environment = {
  ...ceremonyEnvironment,
  protocolWritesEnabled: false,
};
