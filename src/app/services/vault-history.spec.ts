import { VaultDiscoveryService } from './vault-discovery.service';
import { VAULT_HISTORY_FIXTURES } from '../utils/vault-history.fixture';

describe('Current enrolled vault history', () => {
  function setup(index = 0) {
    const f = JSON.parse(JSON.stringify(VAULT_HISTORY_FIXTURES[index]));
    const coinset = {
      getCoinRecordByName: jasmine.createSpy().and.callFake(async (id: string) => f.records[id] ?? null),
      getCoinRecordsByParentIds: jasmine.createSpy().and.callFake(async ([id]: string[]) =>
        Object.values(f.records).filter((row: any) => row.coin.parent_coin_info === id)),
      getPuzzleAndSolution: jasmine.createSpy().and.callFake(async (id: string) => ({
        coin: f.records[id].coin, puzzleReveal: f.stampedPuzzle, solution: '0x80',
      })),
    };
    const service = new VaultDiscoveryService(coinset as any, {isReady:true,coordinates:f.coordinates} as any);
    return {f, service};
  }
  for (const [index, kind] of ['BLS','EVM'].entries()) {
    it(`discovers and resumes two ${kind} successors from the shared API history`, async () => {
      const {f,service} = setup(index);
      for (const id of [f.stampId,f.firstId,f.tipId]) {
        const original = {...f.records[id]};
        f.records[id] = {...original,spent:false,spent_block_index:0};
        const current = await service.refreshFromLauncherId(f.launcherId,f.owner);
        expect(current?.currentCoinId).toBe(id);
        expect(current?.vaultFullPuzhash).toBe(f.stampedHash);
        f.records[id] = original;
      }
    });
  }
  it('rejects a second odd child instead of choosing a provider-selected fork',async () => {
    const {f,service} = setup();
    const sibling = JSON.parse(JSON.stringify(f.records[f.tipId]));
    sibling.coin.puzzle_hash = '0x'+'ab'.repeat(32);
    f.records['fork'] = sibling;
    await expectAsync(service.refreshFromLauncherId(f.launcherId,f.owner)).toBeRejectedWithError(/exactly one/);
  });
  it('rejects a spent-flag alias and a changed release',async () => {
    const {f,service} = setup();
    f.records[f.tipId].spent = true;
    await expectAsync(service.refreshFromLauncherId(f.launcherId,f.owner)).toBeRejectedWithError(/atomic confirmed/);
    f.records[f.tipId].spent = false;
    f.coordinates.poolLauncherId = '0x'+'ab'.repeat(32);
    await expectAsync(service.refreshFromLauncherId(f.launcherId,f.owner)).toBeRejected();
  });
  it('rejects missing canonical continuations',async () => {
    const {f,service} = setup();
    delete f.records[f.tipId];
    await expectAsync(service.refreshFromLauncherId(f.launcherId,f.owner)).toBeRejected();
  });
});
