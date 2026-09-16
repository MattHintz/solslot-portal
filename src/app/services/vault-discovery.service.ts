import { Injectable } from '@angular/core';
import { CoinRecord, CoinsetService } from './coinset.service';
import { SolslotProtocolArtifactService } from './solslot-protocol-artifact.service';
import { coinId, hexToBytes, vaultDiscoveryHint } from '../utils/chia-hash';
import {
  canonicalOwnedVaultHash, EMPTY_VAULT_IDENTITY_ROOT,
  VAULT_SINGLETON_LAUNCHER_HASH, VaultOwnerBinding, VaultOwnerCoordinates,
  vaultRootCandidates,
} from '../utils/vault-owner-proof';

class UnrelatedVaultCandidate extends Error {}

function normalizeHex(value: string): string {
  return '0x' + value.replace(/^0x/i, '').toLowerCase();
}

@Injectable({ providedIn: 'root' })
export class VaultDiscoveryService {
  constructor(
    private readonly coinset: CoinsetService,
    private readonly protocol: SolslotProtocolArtifactService,
  ) {}

  async discoverEvmVault(publicKey: string): Promise<DiscoveredVault | null> {
    return this.discover({ authType: 3, publicKey });
  }

  async discoverChiaVault(publicKey: string): Promise<DiscoveredVault | null> {
    return this.discover({ authType: 1, publicKey });
  }

  async refreshFromLauncherId(
    launcherId: string,
    owner: VaultOwnerBinding,
  ): Promise<DiscoveredVault | null> {
    const context = this.ownerContext(owner);
    const expectedLauncher = normalizeHex(launcherId);
    const launcher = await this.coinset.getCoinRecordByName(expectedLauncher);
    if (!launcher) return null;
    if (this.recordId(launcher) !== expectedLauncher) {
      throw new Error('Vault provider returned a different launcher.');
    }
    return this.walkSingletonChain(launcher, context.owner, context.coordinates);
  }

  private ownerContext(owner: VaultOwnerBinding): {
    owner: VaultOwnerBinding; coordinates: VaultOwnerCoordinates;
  } {
    const coordinates = this.protocol.coordinates;
    if (!this.protocol.isReady || !coordinates ||
        !/^0x[0-9a-f]{64}$/i.test(coordinates.poolLauncherId) ||
        !/^0x[0-9a-f]{64}$/i.test(coordinates.bridgePolicyHash) ||
        /^0x0{64}$/i.test(coordinates.poolLauncherId) ||
        /^0x0{64}$/i.test(coordinates.bridgePolicyHash)) {
      throw new Error('Vault ownership verification needs the verified release coordinates.');
    }
    if (typeof owner?.publicKey !== 'string') {
      throw new Error('Reconnect the wallet to verify its vault owner key.');
    }
    const snapshot = { authType: owner.authType, publicKey: normalizeHex(owner.publicKey) };
    const pinned = {
      poolLauncherId: coordinates.poolLauncherId,
      bridgePolicyHash: coordinates.bridgePolicyHash,
    };
    // Validate the owner before reading any provider-selected candidate.
    canonicalOwnedVaultHash('0x' + '01'.repeat(32), snapshot, pinned, EMPTY_VAULT_IDENTITY_ROOT);
    return { owner: snapshot, coordinates: pinned };
  }

  private async discover(owner: VaultOwnerBinding): Promise<DiscoveredVault | null> {
    const context = this.ownerContext(owner);
    const hint = vaultDiscoveryHint(context.owner.authType, hexToBytes(context.owner.publicKey));
    const candidates = await this.coinset.getCoinRecordsByHint(hint, true);
    const launchers = candidates.filter((record) =>
      normalizeHex(record.coin.puzzle_hash) === VAULT_SINGLETON_LAUNCHER_HASH,
    ).sort((a, b) => b.confirmed_block_index - a.confirmed_block_index);

    for (const launcher of launchers) {
      try {
        const vault = await this.walkSingletonChain(launcher, context.owner, context.coordinates);
        if (vault) return vault;
      } catch (error) {
        // Public hints can name unrelated objects. A provider outage is distinct:
        // propagate it instead of reporting that no existing vault exists.
        if (!(error instanceof UnrelatedVaultCandidate)) throw error;
      }
    }
    return null;
  }

  private recordId(record: CoinRecord): string {
    if (!/^0x[0-9a-f]{64}$/i.test(record.coin.parent_coin_info) ||
        !/^0x[0-9a-f]{64}$/i.test(record.coin.puzzle_hash) ||
        !Number.isSafeInteger(record.coin.amount) || record.coin.amount !== 1) {
      throw new UnrelatedVaultCandidate('Vault candidate has invalid coin fields.');
    }
    return normalizeHex(coinId(record.coin.parent_coin_info, record.coin.puzzle_hash, record.coin.amount));
  }

  private async walkSingletonChain(
    launcher: CoinRecord, owner: VaultOwnerBinding, coordinates: VaultOwnerCoordinates,
  ): Promise<DiscoveredVault | null> {
    if (normalizeHex(launcher.coin.puzzle_hash) !== VAULT_SINGLETON_LAUNCHER_HASH ||
        launcher.coin.amount !== 1 ||
        !Number.isSafeInteger(launcher.confirmed_block_index) ||
        launcher.confirmed_block_index <= 0) {
      throw new UnrelatedVaultCandidate('Vault discovery refused an invalid singleton launcher coin.');
    }
    const launcherId = this.recordId(launcher);
    let current = launcher;
    let currentId = launcherId;
    const seen = new Set([launcherId]);
    let enrolledHash: string | null = null;
    for (let depth = 0; depth < 512; depth++) {
      const children = await this.coinset.getCoinRecordsByParentIds([currentId], true);
      if (!children.length) {
        if (depth === 0 && current.spent_block_index === 0) return null;
        throw new UnrelatedVaultCandidate('Vault singleton chain ended without its confirmed continuation.');
      }
      const odd = children.filter((record) =>
        normalizeHex(record.coin.parent_coin_info) === currentId &&
        Number.isSafeInteger(record.coin.amount) && record.coin.amount > 0 &&
        record.coin.amount % 2 === 1,
      );
      if (odd.length !== 1) {
        throw new UnrelatedVaultCandidate('Vault singleton continuation must contain exactly one direct odd-valued child.');
      }
      const child = odd[0];
      const childId = this.recordId(child);
      if (!Number.isSafeInteger(current.spent_block_index) || current.spent_block_index <= 0 ||
          !Number.isSafeInteger(child.confirmed_block_index) ||
          child.confirmed_block_index !== current.spent_block_index ||
          child.confirmed_block_index < current.confirmed_block_index ||
          !Number.isSafeInteger(child.spent_block_index) || child.spent_block_index < 0 ||
          (child.spent_block_index > 0 && child.spent_block_index < child.confirmed_block_index) ||
          ('spent' in child && (typeof child.spent !== 'boolean' || child.spent !== (child.spent_block_index > 0))) ||
          ('spent' in current && (typeof current.spent !== 'boolean' || current.spent !== (current.spent_block_index > 0)))) {
        throw new UnrelatedVaultCandidate('Vault continuation lacks an atomic confirmed parent spend.');
      }
      if (seen.has(childId)) throw new UnrelatedVaultCandidate('Vault singleton chain contains a cycle.');
      seen.add(childId);
      await this.verifyOwner(launcherId, child, current, owner, coordinates);
      const childHash = normalizeHex(child.coin.puzzle_hash);
      if (enrolledHash && childHash !== enrolledHash) {
        throw new UnrelatedVaultCandidate('Vault history changed its enrolled owner or credential.');
      }
      if (childHash !== canonicalOwnedVaultHash(launcherId, owner, coordinates, EMPTY_VAULT_IDENTITY_ROOT)) {
        enrolledHash = childHash;
      }
      if (child.spent_block_index === 0) {
        return {
          vaultLauncherId: launcherId,
          vaultFullPuzhash: normalizeHex(child.coin.puzzle_hash),
          currentCoinId: childId,
          confirmed: true,
          confirmedBlockIndex: child.confirmed_block_index,
          launcherConfirmedBlockIndex: launcher.confirmed_block_index,
        };
      }
      current = child;
      currentId = childId;
    }
    throw new Error('Vault singleton chain exceeded 512 spends.');
  }

  private async verifyOwner(
    launcherId: string, current: CoinRecord, parent: CoinRecord,
    owner: VaultOwnerBinding, coordinates: VaultOwnerCoordinates,
  ): Promise<void> {
    const matches = (root: string) =>
      canonicalOwnedVaultHash(launcherId, owner, coordinates, root) === normalizeHex(current.coin.puzzle_hash);
    if (matches(EMPTY_VAULT_IDENTITY_ROOT)) return;
    const parentId = this.recordId(parent);
    const spend = await this.coinset.getPuzzleAndSolution(parentId, parent.spent_block_index);
    if (!spend) {
      throw new UnrelatedVaultCandidate('Vault owner proof is unavailable for this candidate.');
    }
    if (this.recordId({ ...parent, coin: spend.coin }) !== parentId) {
      throw new UnrelatedVaultCandidate('Vault owner proof names a different parent.');
    }
    let roots: string[];
    try {
      roots = [...new Set([
        ...vaultRootCandidates(spend.puzzleReveal),
        ...vaultRootCandidates(spend.solution),
      ])];
    } catch {
      throw new UnrelatedVaultCandidate('Vault owner proof is malformed or exceeds its bounds.');
    }
    if (!roots.some(matches)) {
      throw new UnrelatedVaultCandidate('This singleton does not match the connected owner and canonical vault puzzle.');
    }
  }
}

export interface DiscoveredVault {
  vaultLauncherId: string;
  vaultFullPuzhash: string;
  currentCoinId: string;
  confirmed: boolean;
  confirmedBlockIndex: number;
  launcherConfirmedBlockIndex: number;
}
