import { environment as hosted } from './environment.rc28-testnet';
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

// The pre-genesis ceremony must remain unpinned; the post-genesis hosted build must not.
describe('RC28 hosted release', () => {
  it('pins the sealed artifact and source while keeping real passports on solslot.com', () => {
    expect(hosted.solslotProtocol.artifactHash).toBe('0xdd313bf4705dfda7f59e3fb8c24cc1862c6a50994ddd74547eaa30c7727c8140');
    expect(hosted.solslotProtocol.adminPortalSourceSha).toBe('710ea02f18f05f93f5e085a605302b3d540ef9c2');
    expect(hosted.solslotProtocol.artifactVerified).toBeFalse();
    expect(hosted.chiaNetwork).toBe('testnet11');
    expect(hosted.zkPassport.domain).toBe('solslot.com');
    expect(hosted.zkPassport.devMode).toBeFalse();
    expect(hosted.authorityEvmChainId).toBe(8453);
    expect(hosted.eip712ChainId).toBe(11155111);
    expect(ceremonyEnvironment.solslotProtocol.artifactHash).toBe('');
  });
});
