import { initializeChiaTestRuntime } from './chia-runtime';
import { initializeVerifiedChiaRuntime, verifiedChiaRuntime } from '../app/utils/verified-chia-runtime';

describe('Shared verified Chia test runtime', () => {
  it('preserves live coin and CLVM objects across concurrent and later suite initialization', async () => {
    const instantiate = spyOn(WebAssembly, 'instantiate').and.callThrough();
    await initializeChiaTestRuntime();
    const sdk = verifiedChiaRuntime();
    const coin = new sdk['Coin'](new Uint8Array(32).fill(1), new Uint8Array(32).fill(2), 1n);
    const clvm = new sdk['Clvm']();
    const program = clvm.int(42n);
    try {
      const coinId = Array.from(coin.coinId());
      const serialized = Array.from(program.serialize());
      await Promise.all(Array.from({ length: 8 }, () => initializeChiaTestRuntime()));
      await initializeVerifiedChiaRuntime();
      expect(verifiedChiaRuntime()).toBe(sdk);
      expect((window as any).ChiaSDK).toBe(sdk);
      expect(Array.from(coin.coinId())).toEqual(coinId);
      expect(Array.from(program.serialize())).toEqual(serialized);
      expect(instantiate.calls.count()).toBeLessThanOrEqual(1);
    } finally {
      program.free();
      clvm.free();
      coin.free();
    }
  });
});
