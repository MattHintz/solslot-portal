import { environment as ceremonyEnvironment } from './environment.ceremony';
import { environment as stagingEnvironment } from './environment.staging';
import { environment as lockedEnvironment } from './environment.ceremony-locked';

describe('ceremony environment', () => {
  it('enables only the same-origin testnet ceremony build', () => {
    expect(ceremonyEnvironment.protocolWritesEnabled).toBeTrue();
    expect(ceremonyEnvironment.faucetApi).toBe('/protocol-api');
    expect(ceremonyEnvironment.chiaNetwork).toBe('testnet11');
    expect(ceremonyEnvironment.production).toBeTrue();
    expect(stagingEnvironment.protocolWritesEnabled).toBeFalse();
    expect(ceremonyEnvironment.eip712ChainId).toBe(11155111);
    expect(ceremonyEnvironment.authorityEvmChainId).toBe(8453);
    expect(lockedEnvironment.authorityEvmChainId).toBe(8453);
    expect(lockedEnvironment.protocolWritesEnabled).toBeFalse();
  });
});
