import { Injectable } from '@angular/core';
import { computeAddress, SigningKey, verifyTypedData } from 'ethers';
import { environment } from '../../environments/environment';
import { SolslotApiService, SolslotPublicArtifact } from './solslot-api.service';
import {
  clearVerifiedProtocolCoordinates,
  installVerifiedProtocolCoordinates,
} from './protocol-coordinate-guard';

const HEX_20 = /^0x[0-9a-f]{40}$/i;
const HEX_32 = /^0x[0-9a-f]{64}$/i;
const HEX_33 = /^0x[0-9a-f]{66}$/i;
const HEX_48 = /^0x[0-9a-f]{96}$/i;
const HEX_PROGRAM = /^0x(?:[0-9a-f]{2})+$/i;
const GIT_SHA = /^[0-9a-f]{40}$/i;
const REQUIRED_LAUNCHERS = [
  'pool',
  'did',
  'governance',
  'navRegistry',
  'protocolConfig',
  'adminAuthority',
  'vaultVersionRegistry',
  'propertyRegistry',
] as const;

export interface SolslotProtocolCoordinates {
  poolLauncherId: string;
  poolInnerPuzzleHash: string;
  bridgePolicyHash: string;
  governanceLauncherId: string;
  collectionNavRegistryLauncherId: string;
  protocolConfigLauncherId: string;
  adminAuthorityV2LauncherId: string;
  vaultVersionRegistryLauncherId: string;
  propertyRegistryLauncherId: string;
}

@Injectable({ providedIn: 'root' })
export class SolslotProtocolArtifactService {
  private artifactValue: SolslotPublicArtifact | null = null;
  private failureValue = 'Signed Solslot V2 genesis artifact has not been loaded.';

  constructor(private readonly api: SolslotApiService) {}

  get artifact(): SolslotPublicArtifact | null {
    return this.artifactValue;
  }

  get isReady(): boolean {
    return this.artifactValue !== null;
  }

  get failure(): string {
    return this.failureValue;
  }

  get coordinates(): SolslotProtocolCoordinates | null {
    const artifact = this.artifactValue;
    if (!artifact) return null;
    return artifactCoordinates(artifact);
  }

  get adminRoster(): ReadonlyArray<string> {
    return this.artifactValue?.adminAuthority.compressedPubkeys ?? [];
  }

  async initialize(): Promise<void> {
    this.artifactValue = null;
    clearVerifiedProtocolCoordinates();
    clearRuntimeBindings();

    const config = environment.solslotProtocol as Record<string, unknown>;
    const expectedHash = String(config['artifactHash'] || '').toLowerCase();
    const expectedSourceSha = String(config['adminPortalSourceSha'] || '').toLowerCase();

    if (!HEX_32.test(expectedHash) || !GIT_SHA.test(expectedSourceSha)) {
      this.failureValue =
        'This admin release is not pinned to a signed genesis artifact and frozen source commit.';
      return;
    }

    try {
      const artifact = await this.api.getSignedProtocolArtifact();
      await verifyArtifact(artifact, expectedHash, expectedSourceSha);
      const coordinates = artifactCoordinates(artifact);
      installVerifiedProtocolCoordinates({ ...coordinates });
      installRuntimeBindings(artifact, coordinates);
      this.artifactValue = artifact;
      this.failureValue = '';
    } catch (error) {
      clearVerifiedProtocolCoordinates();
      clearRuntimeBindings();
      this.failureValue =
        error instanceof Error
          ? error.message
          : 'Signed Solslot V2 genesis artifact verification failed.';
    }
  }
}

export async function canonicalArtifactHash(artifact: SolslotPublicArtifact): Promise<string> {
  const unsigned = Object.fromEntries(
    Object.entries(artifact).filter(([key]) => key !== 'artifactHash' && key !== 'signatures'),
  );
  const bytes = new TextEncoder().encode(asciiStableJson(unsigned));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `0x${Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

async function verifyArtifact(
  artifact: SolslotPublicArtifact,
  expectedHash: string,
  expectedSourceSha: string,
): Promise<void> {
  if (
    artifact.schemaVersion !== 2 ||
    artifact.sourceManifestVersion !== 3 ||
    artifact.protocolVersion !== 'solslot-v2' ||
    artifact.network !== 'testnet11' ||
    artifact.evmChainId !== 11155111
  ) {
    throw new Error('The public artifact does not describe Solslot V2 testnet11.');
  }
  if (!HEX_32.test(artifact.puzzleHashes.protocolTreasuryPuzzleHash || '')) {
    throw new Error('The public artifact has no protocol treasury puzzle hash.');
  }
  const reviewIsValid =
    (artifact.reviewClass === 'internal-engineering-testnet' &&
      artifact.testOnly === true &&
      artifact.auditStatus === 'unaudited') ||
    (artifact.reviewClass === 'independent-release-review' &&
      artifact.testOnly === false &&
      artifact.auditStatus === 'independently-reviewed');
  if (!reviewIsValid) {
    throw new Error('The public artifact review classification is invalid.');
  }
  if (
    artifact.artifactHash.toLowerCase() !== expectedHash ||
    (await canonicalArtifactHash(artifact)) !== expectedHash
  ) {
    throw new Error('The public artifact hash does not match this admin release.');
  }
  const sourceShas = artifact.sourceShas;
  const requiredSources = [
    'protocol',
    'evm',
    'omnichain',
    'api',
    'legacyBackend',
    'keyOfSolomon',
    'samuel',
    'customerWeb',
    'adminPortal',
  ];
  if (
    !sourceShas ||
    Object.keys(sourceShas).sort().join(',') !== requiredSources.sort().join(',') ||
    Object.values(sourceShas).some((value) => !GIT_SHA.test(value)) ||
    sourceShas.adminPortal.toLowerCase() !== expectedSourceSha
  ) {
    throw new Error('The public artifact does not bind this admin-portal commit.');
  }
  if (
    artifact.ceremony?.requiredChiaConfirmations !== 3 ||
    !Number.isInteger(artifact.ceremony?.confirmedBlockIndex) ||
    artifact.ceremony.confirmedBlockIndex <= 0 ||
    !HEX_32.test(artifact.ceremony?.ceremonyId || '') ||
    !HEX_32.test(artifact.ceremony?.planHash || '') ||
    !HEX_32.test(artifact.ceremony?.spendBundleId || '')
  ) {
    throw new Error('The public artifact does not prove a confirmed ceremony.');
  }

  const launchers = artifact.launcherIds || ({} as SolslotPublicArtifact['launcherIds']);
  const activeLaunchers = REQUIRED_LAUNCHERS.map((key) => launchers[key]);
  if (
    activeLaunchers.some((value) => !HEX_32.test(value || '')) ||
    new Set(activeLaunchers.map((value) => value.toLowerCase())).size !==
      REQUIRED_LAUNCHERS.length ||
    !HEX_32.test(artifact.puzzleHashes?.poolInnerPuzzleHash || '') ||
    !HEX_32.test(artifact.sgtGenesisCoinId || '') ||
    !HEX_32.test(artifact.sgtTailHash || '') ||
    artifact.sgtTailHash.toLowerCase() !==
      String(artifact.puzzleHashes?.sgtTailHash || '').toLowerCase() ||
    !HEX_32.test(artifact.puzzleHashes?.p2PoolModHash || '') ||
    !HEX_32.test(artifact.puzzleHashes?.p2VaultModHash || '')
  ) {
    throw new Error('The public artifact has incomplete or duplicate protocol coordinates.');
  }
  if (
    artifact.protocolDid?.launcherId?.toLowerCase() !== artifact.launcherIds.did.toLowerCase() ||
    artifact.protocolDid?.innerPuzzleHash?.toLowerCase() !==
      String(artifact.puzzleHashes?.didInnerPuzzleHash || '').toLowerCase() ||
    artifact.protocolDid?.fullPuzzleHash?.toLowerCase() !==
      String(artifact.puzzleHashes?.didFullPuzzleHash || '').toLowerCase() ||
    !HEX_PROGRAM.test(artifact.protocolDid?.singletonStruct || '') ||
    artifact.governanceStruct?.launcherId?.toLowerCase() !==
      artifact.launcherIds.governance.toLowerCase() ||
    !HEX_PROGRAM.test(artifact.governanceStruct?.serialized || '') ||
    !HEX_48.test(artifact.governanceStruct?.mintExecuteCosignerPubkey || '') ||
    artifact.propertyRegistry?.launcherId?.toLowerCase() !==
      artifact.launcherIds.propertyRegistry.toLowerCase() ||
    artifact.propertyRegistry?.currentPuzzleHash?.toLowerCase() !==
      String(artifact.puzzleHashes?.propertyRegistryFullPuzzleHash || '').toLowerCase() ||
    !HEX_48.test(artifact.propertyRegistry?.governanceBlsPubkey || '')
  ) {
    throw new Error('The public artifact mint authority material is incomplete.');
  }

  const retired = artifact.retiredCoordinates || [];
  const retiredSet = new Set(retired.map((value) => value.toLowerCase()));
  if (
    retired.length === 0 ||
    retired.some((value) => !HEX_32.test(value)) ||
    activeLaunchers.some((value) => retiredSet.has(value.toLowerCase()))
  ) {
    throw new Error('The public artifact retired-coordinate boundary is invalid.');
  }

  const bridge = artifact.bridgePolicy;
  if (
    bridge?.policyVersion !== 2 ||
    bridge?.initialCoinCount !== 32 ||
    bridge?.lowWaterMark !== 8 ||
    !HEX_32.test(bridge?.policyHash || '') ||
    bridge?.parentCoinIds?.length !== 32 ||
    bridge?.bridgeCoinIds?.length !== 32 ||
    [...bridge.parentCoinIds, ...bridge.bridgeCoinIds].some((value) => !HEX_32.test(value)) ||
    new Set(bridge.parentCoinIds.map((value) => value.toLowerCase())).size !== 32 ||
    new Set(bridge.bridgeCoinIds.map((value) => value.toLowerCase())).size !== 32
  ) {
    throw new Error('The public artifact bridge policy is not the V2 32-coin policy.');
  }
  if (
    artifact.validatorSet?.threshold !== 2 ||
    artifact.validatorSet?.pubkeys?.length !== 3 ||
    artifact.validatorSet.pubkeys.some((value) => !HEX_48.test(value)) ||
    artifact.adminAuthority?.threshold !== 2 ||
    artifact.adminAuthority?.policy !== 'owner-plus-one' ||
    artifact.adminAuthority?.ownerIndex !== 0 ||
    JSON.stringify(artifact.adminAuthority?.coadminIndices) !== '[1,2]' ||
    artifact.adminAuthority?.coadminThreshold !== 1 ||
    artifact.adminAuthority?.compressedPubkeys?.length !== 3 ||
    artifact.adminAuthority.compressedPubkeys.some((value) => !HEX_33.test(value)) ||
    !HEX_32.test(artifact.adminAuthority.rosterHash || '') ||
    !HEX_32.test(artifact.adminAuthority.mipsRootHash || '') ||
    artifact.signaturePolicy?.type !== 'SolslotGenesisArtifact' ||
    artifact.signaturePolicy?.threshold !== 2 ||
    artifact.signaturePolicy?.policy !== 'owner-plus-one' ||
    artifact.signaturePolicy?.ownerIndex !== 0 ||
    JSON.stringify(artifact.signaturePolicy?.coadminIndices) !== '[1,2]' ||
    artifact.signaturePolicy?.coadminThreshold !== 1 ||
    artifact.signaturePolicy?.rosterHash?.toLowerCase() !==
      artifact.adminAuthority.rosterHash.toLowerCase()
  ) {
    throw new Error('The public artifact does not carry owner-plus-one admin authority.');
  }
  const addresses = artifact.evmAddresses;
  if (
    !addresses ||
    !HEX_20.test(addresses.forwarder || '') ||
    !HEX_20.test(addresses.verifierAdapter || '') ||
    !HEX_20.test(addresses.attestationEmitter || '')
  ) {
    throw new Error('The public artifact does not bind the fresh EVM contracts.');
  }

  const signatures = artifact.signatures || [];
  const seen = new Set<number>();
  let valid = 0;
  for (const item of signatures) {
    const index = Number(item.adminIndex);
    if (!Number.isInteger(index) || index < 0 || index > 2 || seen.has(index)) {
      continue;
    }
    const rosterKey = artifact.adminAuthority.compressedPubkeys[index];
    if (rosterKey.toLowerCase() !== String(item.compressedPubkey || '').toLowerCase()) {
      continue;
    }
    try {
      const signer = verifyTypedData(
        {
          name: 'Solslot Protocol',
          version: '2',
          chainId: artifact.evmChainId,
        },
        {
          SolslotGenesisArtifact: [
            { name: 'artifactHash', type: 'bytes32' },
            { name: 'ceremonyId', type: 'bytes32' },
            { name: 'planHash', type: 'bytes32' },
            { name: 'network', type: 'string' },
          ],
        },
        {
          artifactHash: artifact.artifactHash,
          ceremonyId: artifact.ceremony.ceremonyId,
          planHash: artifact.ceremony.planHash,
          network: artifact.network,
        },
        item.signature,
      );
      const rosterAddress = computeAddress(SigningKey.computePublicKey(rosterKey, false));
      if (signer.toLowerCase() === rosterAddress.toLowerCase()) {
        seen.add(index);
        valid += 1;
      }
    } catch {
      // Invalid signatures count as absent.
    }
  }
  if (valid < 2 || !seen.has(0) || (!seen.has(1) && !seen.has(2))) {
    throw new Error('The public artifact requires slot 0 and one valid coadmin signature.');
  }
}

function artifactCoordinates(artifact: SolslotPublicArtifact): SolslotProtocolCoordinates {
  return {
    poolLauncherId: artifact.launcherIds.pool,
    poolInnerPuzzleHash: artifact.puzzleHashes.poolInnerPuzzleHash,
    bridgePolicyHash: artifact.bridgePolicy.policyHash,
    governanceLauncherId: artifact.launcherIds.governance,
    collectionNavRegistryLauncherId: artifact.launcherIds.navRegistry,
    protocolConfigLauncherId: artifact.launcherIds.protocolConfig,
    adminAuthorityV2LauncherId: artifact.launcherIds.adminAuthority,
    vaultVersionRegistryLauncherId: artifact.launcherIds.vaultVersionRegistry,
    propertyRegistryLauncherId: artifact.launcherIds.propertyRegistry,
  };
}

function installRuntimeBindings(
  artifact: SolslotPublicArtifact,
  coordinates: SolslotProtocolCoordinates,
): void {
  const adminAddresses = artifact.adminAuthority.compressedPubkeys.map((pubkey) =>
    computeAddress(SigningKey.computePublicKey(pubkey, false)).toLowerCase(),
  );
  Object.assign(environment.solslotProtocol, coordinates, {
    artifactVerified: true,
    retiredCoordinates: [...artifact.retiredCoordinates],
    adminAuthorityV2MipsRootHash: artifact.adminAuthority.mipsRootHash,
    adminAuthorityV2AdminAddresses: adminAddresses,
    adminAuthorityV2AdminPubkeys: [...artifact.adminAuthority.compressedPubkeys],
    governanceQuorumBps: artifact.protocolParameters.quorumBps,
    governanceVotingWindowSeconds: artifact.protocolParameters.votingWindowSeconds,
    governanceSgtTotalSupply: artifact.protocolParameters.sgtTotalSupply,
    governanceMinProposalStake: artifact.protocolParameters.minProposalStake,
    sgtGenesisCoinId: artifact.sgtGenesisCoinId,
    sgtTailHash: artifact.sgtTailHash,
    propertyRegistryLauncherId: artifact.launcherIds.propertyRegistry,
    propertyRegistryGovPubkey: artifact.propertyRegistry.governanceBlsPubkey,
    propertyRegistryCurrentPuzzleHash: artifact.propertyRegistry.currentPuzzleHash,
    propertyRegistryModHash: artifact.puzzleHashes.propertyRegistryInnerModHash || '',
    protocolDidLauncherId: artifact.protocolDid.launcherId,
    protocolDidSingletonStructHex: artifact.protocolDid.singletonStruct,
    protocolDidPuzhash: artifact.protocolDid.fullPuzzleHash,
    protocolDidInnerPuzhash: artifact.protocolDid.innerPuzzleHash,
    governanceSingletonStructHex: artifact.governanceStruct.serialized,
    p2PoolModHash: artifact.puzzleHashes.p2PoolModHash || '',
    p2VaultModHash: artifact.puzzleHashes.p2VaultModHash || '',
  });
  Object.assign(environment.zkPassport, {
    policyVersion: artifact.bridgePolicy.policyVersion,
    evmChainId: artifact.evmChainId,
    attestationEmitterAddress: artifact.evmAddresses.attestationEmitter,
    trustedForwarderAddress: artifact.evmAddresses.forwarder,
    bridgeParentId: '',
    bridgeAmount: 1,
    validatorPubkeys: [...artifact.validatorSet.pubkeys],
    validatorThreshold: artifact.validatorSet.threshold,
  });
}

function clearRuntimeBindings(): void {
  Object.assign(environment.solslotProtocol, {
    artifactVerified: false,
    retiredCoordinates: [],
    adminAuthorityV2LauncherId: '',
    adminAuthorityV2MipsRootHash: '',
    adminAuthorityV2AdminAddresses: [],
    adminAuthorityV2AdminPubkeys: [],
    protocolConfigLauncherId: '',
    collectionNavRegistryLauncherId: '',
    poolLauncherId: '',
    poolInnerPuzzleHash: '',
    bridgePolicyHash: '',
    governanceLauncherId: '',
    sgtGenesisCoinId: '',
    sgtTailHash: '',
    propertyRegistryLauncherId: '',
    propertyRegistryGovPubkey: '',
    propertyRegistryCurrentPuzzleHash: '',
    propertyRegistryModHash: '',
    protocolDidLauncherId: '',
    protocolDidSingletonStructHex: '',
    protocolDidPuzhash: '',
    protocolDidInnerPuzhash: '',
    governanceSingletonStructHex: '',
    p2PoolModHash: '',
    p2VaultModHash: '',
    vaultVersionRegistryLauncherId: '',
  });
  Object.assign(environment.zkPassport, {
    attestationEmitterAddress: '',
    trustedForwarderAddress: '',
    bridgeParentId: '',
    validatorPubkeys: [],
    validatorThreshold: 0,
  });
}

function asciiStableJson(value: unknown): string {
  return JSON.stringify(sortJson(value)).replace(
    /[\u007f-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}
