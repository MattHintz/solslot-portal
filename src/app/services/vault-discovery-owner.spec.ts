import { VaultDiscoveryService } from './vault-discovery.service';
import { coinId } from '../utils/chia-hash';
import { canonicalOwnedVaultHash, EMPTY_VAULT_IDENTITY_ROOT, VAULT_SINGLETON_LAUNCHER_HASH } from '../utils/vault-owner-proof';
import { VAULT_OWNER_API_VECTORS, VAULT_OWNER_STAMP_FIXTURE } from '../utils/vault-owner-api.fixture';

describe('Vault discovery owner boundary', () => {
  const vector = VAULT_OWNER_API_VECTORS[0];
  function setup(withUnrelated = false) {
    const launchers = [1, 2].map((i) => ({
      coin: { parent_coin_info: '0x' + String(i).repeat(64), puzzle_hash: VAULT_SINGLETON_LAUNCHER_HASH, amount: 1 },
      confirmed_block_index: 10 + i,
      spent_block_index: 20 + i,
      coinbase: false,
    }));
    const ids = launchers.map((row) => coinId(row.coin.parent_coin_info, row.coin.puzzle_hash, row.coin.amount));
    const coinset = {
      getCoinRecordsByHint: jasmine.createSpy().and.resolveTo(withUnrelated ? launchers : [launchers[0]]),
      getCoinRecordByName: jasmine.createSpy().and.callFake(async (id: string) => launchers[ids.indexOf(id)] ?? null),
      getCoinRecordsByParentIds: jasmine.createSpy().and.callFake(async ([id]: string[]) => {
        const i = ids.indexOf(id);
        if (i < 0) return [];
        return [{
          coin: { parent_coin_info: id, amount: 1,
            puzzle_hash: i === 0 ? canonicalOwnedVaultHash(id, vector.owner, vector.coordinates, EMPTY_VAULT_IDENTITY_ROOT) : '0x' + 'ab'.repeat(32) },
          confirmed_block_index: launchers[i].spent_block_index,
          spent_block_index: 0, coinbase: false,
        }];
      }),
      getPuzzleAndSolution: jasmine.createSpy().and.resolveTo(null),
    };
    const protocol = { isReady: true, coordinates: vector.coordinates };
    const service: VaultDiscoveryService = new (VaultDiscoveryService as any)(coinset, protocol);
    return { service, ids, coinset };
  }

  it('skips a newer unrelated singleton carrying the same public hint', async () => {
    const { service, ids } = setup(true);
    const found = await service.discoverChiaVault(vector.owner.publicKey);
    expect(found?.vaultLauncherId).toBe(ids[0]);
  });

  it('refuses to restore a launcher whose canonical puzzle does not bind the owner', async () => {
    const { service, ids } = setup(true);
    await expectAsync((service.refreshFromLauncherId as any)(ids[1], vector.owner)).toBeRejected();
  });

  it('discovers an honest single-owner vault through the same hint boundary', async () => {
    const { service, ids } = setup();
    const found = await service.discoverChiaVault(vector.owner.publicKey);
    expect(found?.vaultLauncherId).toBe(ids[0]);
    expect(found?.confirmed).toBeTrue();
  });

  function stampedSetup() {
    const f = JSON.parse(JSON.stringify(VAULT_OWNER_STAMP_FIXTURE));
    const coinset = {
      getCoinRecordsByHint: jasmine.createSpy().and.resolveTo([f.launcher]),
      getCoinRecordByName: jasmine.createSpy().and.resolveTo(f.launcher),
      getCoinRecordsByParentIds: jasmine.createSpy().and.callFake(async ([id]: string[]) =>
        id === f.launcherId ? [f.eve] : id === f.eveId ? [f.successor] : []),
      getPuzzleAndSolution: jasmine.createSpy().and.resolveTo(f.spend),
    };
    const protocol = { isReady: true, coordinates: f.coordinates };
    const service = new VaultDiscoveryService(coinset as any, protocol as any);
    return { f, coinset, protocol, service };
  }

  it('reconstructs the current owner puzzle after an actual protocol identity update', async () => {
    const { f, coinset, service } = stampedSetup();
    const found = await service.refreshFromLauncherId(f.launcherId, f.owner);
    expect(found?.currentCoinId).toBe(f.successorId);
    expect(found?.vaultFullPuzhash).toBe(f.successor.coin.puzzle_hash);
    expect(coinset.getPuzzleAndSolution).toHaveBeenCalledOnceWith(f.eveId, 12);
  });

  it('rejects a root preimage that does not reconstruct the current canonical coin', async () => {
    const { f, service } = stampedSetup();
    f.successor.coin.puzzle_hash = '0x' + 'aa'.repeat(32);
    await expectAsync(service.refreshFromLauncherId(f.launcherId, f.owner)).toBeRejected();
  });

  it('rejects inconsistent parent/child confirmation evidence', async () => {
    const { f, coinset, service } = stampedSetup();
    f.successor.confirmed_block_index = 13;
    await expectAsync(service.refreshFromLauncherId(f.launcherId, f.owner)).toBeRejectedWithError(/atomic confirmed/);
    expect(coinset.getPuzzleAndSolution).not.toHaveBeenCalled();
  });

  it('requires the verified deployment before reading any provider-selected vault', async () => {
    const { f, coinset, protocol, service } = stampedSetup();
    protocol.isReady = false;
    await expectAsync(service.discoverChiaVault(f.owner.publicKey)).toBeRejectedWithError(/verified release/);
    expect(coinset.getCoinRecordsByHint).not.toHaveBeenCalled();
  });
});
