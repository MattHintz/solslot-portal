import { environment as ceremonyEnvironment } from './environment.ceremony';
import { environment as stagingEnvironment } from './environment.staging';

describe('ceremony environment', () => {
  it('enables only the same-origin testnet ceremony build', () => {
    expect(ceremonyEnvironment.protocolWritesEnabled).toBeTrue();
    expect(ceremonyEnvironment.faucetApi).toBe('/protocol-api');
    expect(ceremonyEnvironment.chiaNetwork).toBe('testnet11');
    expect(ceremonyEnvironment.production).toBeTrue();
    expect(stagingEnvironment.protocolWritesEnabled).toBeFalse();
  });
});
