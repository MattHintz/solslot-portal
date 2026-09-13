import { TestBed } from '@angular/core/testing';
import { ADMIN_VAULT_SESSION_STORAGE_KEY, PersistedSession, SessionService } from './session.service';
import { DiscoveredVault, VaultDiscoveryService } from './vault-discovery.service';
import { ChiaWasmService } from './chia-wasm.service';
import { environment } from '../../environments/environment';

const LAUNCHER = '0x' + '11'.repeat(32);
const NEXT_LAUNCHER = '0x' + '22'.repeat(32);
const OWNER = '0x' + '33'.repeat(20);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function discovered(launcher = LAUNCHER, coin = '44'): DiscoveredVault {
  return { vaultLauncherId: launcher, vaultFullPuzhash: '0x' + '55'.repeat(32),
    currentCoinId: '0x' + coin.repeat(32), confirmed: true,
    confirmedBlockIndex: 10, launcherConfirmedBlockIndex: 5 };
}

function publicBinding(): PersistedSession {
  return { schemaVersion: 2, protocolVersion: 'solslot-v2', experienceMode: 'testnet-alpha',
    network: 'testnet11', authType: 'evm', address: OWNER, vaultLauncherId: LAUNCHER, createdAt: 123 };
}

describe('SessionService vault refresh and storage isolation', () => {
  let discovery: { refreshFromLauncherId: jasmine.Spy };
  const runtime = environment as { experienceMode: string; chiaNetwork: string };
  const initialExperienceMode = runtime.experienceMode;
  const initialNetwork = runtime.chiaNetwork;

  beforeEach(() => {
    runtime.experienceMode = initialExperienceMode;
    runtime.chiaNetwork = initialNetwork;
    localStorage.clear();
    discovery = { refreshFromLauncherId: jasmine.createSpy('refreshFromLauncherId').and.resolveTo(null) };
    TestBed.configureTestingModule({ providers: [
      SessionService,
      { provide: VaultDiscoveryService, useValue: discovery },
      { provide: ChiaWasmService, useValue: { sdk: () => { throw new Error('WASM fixture unavailable'); } } },
    ] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    runtime.experienceMode = initialExperienceMode;
    runtime.chiaNetwork = initialNetwork;
    localStorage.clear();
  });

  function connected(): SessionService {
    const service = TestBed.inject(SessionService);
    service.setEvmSession(OWNER, LAUNCHER);
    return service;
  }

  it('restores the exact scoped admin public binding', () => {
    localStorage.setItem(ADMIN_VAULT_SESSION_STORAGE_KEY, JSON.stringify(publicBinding()));
    const service = TestBed.inject(SessionService);
    expect(service.session()?.vaultLauncherId).toBe(LAUNCHER);
    expect(ADMIN_VAULT_SESSION_STORAGE_KEY).toBe('solslot:admin:testnet-alpha:testnet11:session:v2');
  });

  for (const key of ['solslot_session_v2', 'solslot:customer:testnet-alpha:testnet11:session:v2',
    'solslot:admin:mainnet-beta:mainnet:session:v2']) {
    it(`ignores and preserves other storage scope ${key}`, () => {
      const raw = JSON.stringify(publicBinding());
      localStorage.setItem(key, raw);
      const service = TestBed.inject(SessionService);
      expect(service.session()).toBeNull();
      service.clear();
      TestBed.tick();
      expect(localStorage.getItem(key)).toBe(raw);
      expect(localStorage.getItem(ADMIN_VAULT_SESSION_STORAGE_KEY)).toBeNull();
    });
  }

  it('retains payload validation inside the new namespace', () => {
    localStorage.setItem(ADMIN_VAULT_SESSION_STORAGE_KEY, JSON.stringify({ ...publicBinding(), network: 'mainnet' }));
    expect(TestBed.inject(SessionService).session()).toBeNull();
    expect(localStorage.getItem(ADMIN_VAULT_SESSION_STORAGE_KEY)).toBeNull();
  });

  for (const scope of [
    { experienceMode: 'mainnet-beta-preview', chiaNetwork: 'mainnet' },
    { experienceMode: 'mainnet-beta-preview', chiaNetwork: 'testnet11' },
    { experienceMode: 'testnet-alpha', chiaNetwork: 'mainnet' },
  ]) {
    it(`rejects bindings and discovery in runtime ${scope.experienceMode}/${scope.chiaNetwork}`, async () => {
      const stored = JSON.stringify(publicBinding());
      localStorage.setItem(ADMIN_VAULT_SESSION_STORAGE_KEY, stored);
      Object.assign(runtime, scope);
      const service = TestBed.inject(SessionService);
      expect(service.session()).toBeNull();
      expect(() => service.setEvmSession(OWNER, LAUNCHER)).toThrowError(/Testnet Alpha/);
      expect(() => service.setChiaSession('0x' + '66'.repeat(48), LAUNCHER)).toThrowError(/Testnet Alpha/);
      expect(await service.refreshVault()).toBeNull();
      expect(discovery.refreshFromLauncherId).not.toHaveBeenCalled();
      expect(service.vault()).toBeNull();
      TestBed.tick();
      expect(localStorage.getItem(ADMIN_VAULT_SESSION_STORAGE_KEY)).toBe(stored);
    });
  }

  it('discards pending discovery and clears memory if runtime changes during the await', async () => {
    const service = connected();
    discovery.refreshFromLauncherId.and.resolveTo(discovered());
    expect(await service.refreshVault()).not.toBeNull();
    TestBed.tick();
    const stored = localStorage.getItem(ADMIN_VAULT_SESSION_STORAGE_KEY);
    const pending = deferred<DiscoveredVault | null>();
    discovery.refreshFromLauncherId.and.returnValue(pending.promise);
    const refresh = service.refreshVault();
    runtime.experienceMode = 'mainnet-beta-preview';
    runtime.chiaNetwork = 'mainnet';
    pending.resolve(discovered());
    expect(await refresh).toBeNull();
    expect(service.session()).toBeNull();
    expect(service.vault()).toBeNull();
    TestBed.tick();
    expect(localStorage.getItem(ADMIN_VAULT_SESSION_STORAGE_KEY)).toBe(stored);
  });

  it('persists public bindings only in the admin namespace', () => {
    connected();
    TestBed.tick();
    expect(JSON.parse(localStorage.getItem(ADMIN_VAULT_SESSION_STORAGE_KEY)!).vaultLauncherId).toBe(LAUNCHER);
    expect(localStorage.getItem('solslot_session_v2')).toBeNull();
    expect(localStorage.getItem('solslot:customer:testnet-alpha:testnet11:session:v2')).toBeNull();
  });

  it('does not apply old discovery after an account change and clears the old vault immediately', async () => {
    const service = connected();
    discovery.refreshFromLauncherId.and.resolveTo(discovered());
    expect(await service.refreshVault()).not.toBeNull();
    const pending = deferred<DiscoveredVault | null>();
    discovery.refreshFromLauncherId.and.returnValue(pending.promise);
    const refresh = service.refreshVault();
    service.setEvmSession('0x' + '77'.repeat(20), NEXT_LAUNCHER);
    expect(service.vault()).toBeNull();
    pending.resolve(discovered());
    expect(await refresh).toBeNull();
    expect(service.session()?.vaultLauncherId).toBe(NEXT_LAUNCHER);
    expect(service.vault()).toBeNull();
  });

  it('does not restore a vault after logout', async () => {
    const service = connected();
    const pending = deferred<DiscoveredVault | null>();
    discovery.refreshFromLauncherId.and.returnValue(pending.promise);
    const refresh = service.refreshVault();
    service.clear();
    pending.resolve(discovered());
    expect(await refresh).toBeNull();
    expect(service.session()).toBeNull();
    expect(service.vault()).toBeNull();
    TestBed.tick();
    expect(localStorage.getItem(ADMIN_VAULT_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('keeps newer refresh results when older discovery resolves last', async () => {
    const service = connected();
    const older = deferred<DiscoveredVault | null>();
    discovery.refreshFromLauncherId.and.returnValues(older.promise, Promise.resolve(discovered(LAUNCHER, '99')));
    const first = service.refreshVault();
    const latest = await service.refreshVault();
    expect(latest?.current_coin_id).toBe('0x' + '99'.repeat(32));
    older.resolve(discovered());
    expect(await first).toBeNull();
    expect(service.vault()).toBe(latest);
  });

  it('invalidates old confirmed state while refreshing and after missing discovery', async () => {
    const service = connected();
    discovery.refreshFromLauncherId.and.resolveTo(discovered());
    expect((await service.refreshVault())?.confirmed).toBeTrue();
    const pending = deferred<DiscoveredVault | null>();
    discovery.refreshFromLauncherId.and.returnValue(pending.promise);
    const refresh = service.refreshVault();
    expect(service.vault()).toBeNull();
    pending.resolve(null);
    expect(await refresh).toBeNull();
    expect(service.vault()).toBeNull();
    expect(service.session()?.vaultLauncherId).toBe(LAUNCHER);
  });

  it('does not retain confirmed state when discovery fails', async () => {
    const service = connected();
    discovery.refreshFromLauncherId.and.resolveTo(discovered());
    expect((await service.refreshVault())?.confirmed).toBeTrue();
    discovery.refreshFromLauncherId.and.rejectWith(new Error('provider unavailable'));
    await expectAsync(service.refreshVault()).toBeRejectedWithError('provider unavailable');
    expect(service.vault()).toBeNull();
    expect(service.session()?.vaultLauncherId).toBe(LAUNCHER);
  });

  it('invalidates a pending refresh when upgrading the launcher', async () => {
    const service = connected();
    const older = deferred<DiscoveredVault | null>();
    discovery.refreshFromLauncherId.and.returnValue(older.promise);
    const first = service.refreshVault();
    service.setVaultLauncherId(NEXT_LAUNCHER);
    older.resolve(discovered());
    expect(await first).toBeNull();
    expect(service.session()?.vaultLauncherId).toBe(NEXT_LAUNCHER);
    expect(service.vault()).toBeNull();
  });
});
