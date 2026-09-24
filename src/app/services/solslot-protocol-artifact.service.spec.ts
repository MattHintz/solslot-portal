import { activationContext, artifactActivation, EnrollmentActivation, permitBridgePolicy, hashJson, BRIDGE_MODULE_HASH } from '../utils/enrollment-activation';
import { environment as ceremonyLockedEnvironment } from '../../environments/environment.ceremony-locked';
import { environment as stagingEnvironment } from '../../environments/environment.staging';
import baseIdentityVector from '../utils/enrollment-permit-base-identity-v1.json';
import { SigningKey, Wallet } from 'ethers';
import { environment } from '../../environments/environment';
import { SolslotApiService, SolslotPublicArtifact } from './solslot-api.service';
import {
  canonicalArtifactHash,
  verifyInventoryActivation,
  SolslotProtocolArtifactService,
} from './solslot-protocol-artifact.service';
import {
  clearVerifiedProtocolCoordinates,
  protocolCoordinateFromEnvironment,
} from './protocol-coordinate-guard';

const SOURCE_SHA = 'a'.repeat(40);
const HASH = (byte: string) => `0x${byte.repeat(32)}`;
const ADDRESS = (byte: string) => `0x${byte.repeat(20)}`;
const originalOperationalChain = environment.eip712ChainId;
const originalProtocol = { ...environment.solslotProtocol };
const originalZkPassport = { ...environment.zkPassport };

describe('signed inventory activation content', () => {
  it('accepts reviewed Base test payments with separate Sepolia identity and rejects binding drift', async () => {
    const { INVENTORY_V3_HASH, RESERVED_V6_HASH, BASE_TEST_PAYMENT_PROFILE } = await import('./mint-proposal-v2/base-inventory-puzzles');
    const artifact = await signedArtifact();
    artifact.paymentChainId = 8453;
    artifact.genesisPlan = { ...artifact.genesisPlan, paymentChainId: 8453 };
    artifact.inventoryActivation = {
      schema: 'solslot.inventory-activation.v2', network: 'testnet11',
      environment: environment.zkPassport.deploymentEnvironment as 'staging-alpha' | 'production-alpha',
      deploymentId: artifact.ceremony.ceremonyId, inventoryVersion: 3, adapterVersion: 2,
      availableModuleHash: INVENTORY_V3_HASH, reservedModuleHash: RESERVED_V6_HASH,
      sourceShas: { ...artifact.sourceShas }, reviewEvidenceSha256: 'ab'.repeat(32),
      paymentProfile: BASE_TEST_PAYMENT_PROFILE,
    };
    expect(artifact.evmChainId).toBe(11155111);
    expect(() => verifyInventoryActivation(artifact)).not.toThrow();
    for (const change of [ { tokenAddress: ADDRESS('33') }, { tokenDecimals: 3 }, { hasMonetaryValue: true } ]) {
      artifact.inventoryActivation.paymentProfile = { ...BASE_TEST_PAYMENT_PROFILE, ...change };
      expect(() => verifyInventoryActivation(artifact)).toThrow();
    }
    artifact.inventoryActivation.paymentProfile = BASE_TEST_PAYMENT_PROFILE;
    artifact.genesisPlan['paymentChainId'] = 84532;
    expect(() => verifyInventoryActivation(artifact)).toThrow();
  });
  it('keeps historical artifacts readable and requires activation for new mints', async () => {
    const artifact = await signedArtifact();
    expect(() => verifyInventoryActivation(artifact, false)).not.toThrow();
    expect(() => verifyInventoryActivation(artifact)).toThrowError(/activation/);
  });

  it('binds exact deployment, source, environment and puzzle versions', async () => {
    const { INVENTORY_V2_HASH, RESERVED_V5_HASH } = await import('./mint-proposal-v2/inventory-puzzles');
    const artifact = await signedArtifact();
    const runtime = environment.runtimeEnvironment;
    environment.runtimeEnvironment = 'staging';
    try {
      artifact.inventoryActivation = {
        schema: 'solslot.inventory-activation.v1', network: 'testnet11', environment: 'staging-alpha',
        deploymentId: artifact.ceremony.ceremonyId, inventoryVersion: 2, adapterVersion: 1,
        availableModuleHash: INVENTORY_V2_HASH, reservedModuleHash: RESERVED_V5_HASH,
        sourceShas: { ...artifact.sourceShas }, reviewEvidenceSha256: 'ab'.repeat(32),
      };
      expect(() => verifyInventoryActivation(artifact)).not.toThrow();
      const original = structuredClone(artifact.inventoryActivation);
      for (const [key, value] of Object.entries({environment: 'production-alpha', inventoryVersion: 1,
        availableModuleHash: HASH('00'), deploymentId: HASH('00'), sourceShas: {}, reviewEvidenceSha256: '00'.repeat(32)})) {
        artifact.inventoryActivation = { ...original, [key]: value };
        expect(() => verifyInventoryActivation(artifact)).withContext(key).toThrowError(/does not match/);
      }
    } finally { environment.runtimeEnvironment = runtime; }
  });
});

async function signedArtifact(slots: number[] = [0, 2], evmChainId = 11155111, identityChain?: 8453 | 84532, sourceManifestVersion: 3 | 4 = 3): Promise<SolslotPublicArtifact> {
  const wallets = ['01', '02', '03'].map((byte) => new Wallet(`0x${byte.repeat(32)}`));
  const compressedPubkeys = wallets.map((wallet) =>
    SigningKey.computePublicKey(wallet.privateKey, true),
  );
  const identityLaunchers = [HASH('19'), HASH('1a'), HASH('1b')] as const;
  const identityVaults = ([0, 1, 2] as const).map((slot) => ({
    slot,
    launcherAmount: ([3, 5, 7] as const)[slot],
    launcherId: identityLaunchers[slot],
    dailyCompressedPubkey: compressedPubkeys[slot],
    dailyMemberHash: HASH((30 + slot).toString(16)),
    recoveryMemberHash: HASH((33 + slot).toString(16)),
    recoveryBlsPubkey: `0x${(61 + slot).toString(16).repeat(48)}`,
    custodyHash: HASH((36 + slot).toString(16)),
    fullPuzzleHash: HASH((39 + slot).toString(16)),
  })) as SolslotPublicArtifact['adminAuthority']['identityVaults'];
  const recoveryKits = ([0, 1, 2] as const).map((slot) => ({
    slot,
    revision: 1,
    evmGuardian: ADDRESS((71 + slot).toString(16)),
    recoveryBlsPubkey: identityVaults[slot].recoveryBlsPubkey,
    recoveryBlsCommitment: HASH((42 + slot).toString(16)),
    drillChallengeHash: HASH((45 + slot).toString(16)),
  })) as SolslotPublicArtifact['adminAuthority']['recoveryKits'];
  const artifact = {
    schemaVersion: 4,
    sourceManifestVersion,
    protocolVersion: 'solslot-v2-rc23',
    network: 'testnet11',
    evmChainId,
    reviewClass: 'internal-engineering-testnet',
    testOnly: true,
    auditStatus: 'pending-external-review',
    buildTimestamp: '2026-07-14T00:00:00+00:00',
    artifactHash: '',
    sourceShas: {
      protocol: '1'.repeat(40),
      evm: '2'.repeat(40),
      omnichain: '3'.repeat(40),
      api: '4'.repeat(40),
      legacyBackend: '5'.repeat(40),
      keyOfSolomon: '6'.repeat(40),
      samuel: '7'.repeat(40),
      customerWeb: '8'.repeat(40),
      adminPortal: SOURCE_SHA,
    },
    ceremony: {
      ceremonyId: HASH('a1'),
      planHash: HASH('a2'),
      spendBundleId: HASH('a3'),
      confirmedBlockIndex: 123,
      requiredChiaConfirmations: 3,
    },
    launcherIds: {
      pool: HASH('11'),
      did: HASH('12'),
      governance: HASH('13'),
      statutes: HASH('14'),
      protocolConfig: HASH('15'),
      adminAuthority: HASH('16'),
      vaultVersionRegistry: HASH('17'),
      propertyRegistry: HASH('18'),
      adminIdentity0: identityLaunchers[0],
      adminIdentity1: identityLaunchers[1],
      adminIdentity2: identityLaunchers[2],
    },
    puzzleHashes: {
      poolInnerPuzzleHash: HASH('21'),
      p2PoolModHash: HASH('22'),
      p2VaultModHash: HASH('24'),
      sgtTailHash: HASH('23'),
      didInnerPuzzleHash: HASH('25'),
      didFullPuzzleHash: HASH('26'),
      protocolTreasuryPuzzleHash: HASH('2a'),
      propertyRegistryInnerModHash: HASH('27'),
      propertyRegistryFullPuzzleHash: HASH('28'),
    },
    sgtGenesisCoinId: HASH('24'),
    sgtTailHash: HASH('23'),
    governanceStruct: {
      treeHash: HASH('29'),
      launcherId: HASH('13'),
      serialized: '0xff80',
      mintExecuteCosignerPubkey: `0x${'2b'.repeat(48)}`,
    },
    protocolDid: {
      launcherId: HASH('12'),
      singletonStruct: '0xff80',
      innerPuzzleHash: HASH('25'),
      fullPuzzleHash: HASH('26'),
    },
    propertyRegistry: {
      launcherId: HASH('18'),
      governanceBlsPubkey: `0x${'2a'.repeat(48)}`,
      currentPuzzleHash: HASH('28'),
    },
    protocolParameters: {
      smartDeedPuzzleVersion: 3,
      poolPuzzleVersion: 3,
      sgtTotalSupply: 1_000_000,
      quorumBps: 5000,
      votingWindowSeconds: 300,
      minProposalStake: 10_000,
    },
    stateVersions: {
      statutes: 1,
      pool: 4,
      protocolConfig: 1,
      adminAuthority: 3,
      vault: 2,
      propertyRegistry: 0,
    },
    adminAuthority: {
      version: 3,
      threshold: 2,
      policy: 'owner-plus-one',
      ownerIndex: 0,
      coadminIndices: [1, 2],
      coadminThreshold: 1,
      rosterHash: HASH('26'),
      sourceManifestHash: HASH('27'),
      operationalMipsRootHash: HASH('28'),
      lostRecoveryMipsRootHashes: [HASH('2b'), HASH('2c'), HASH('2d')],
      routineDelaySeconds: 86400,
      lostKeyDelaySeconds: 604800,
      identityVaults,
      compressedPubkeys,
      recoveryKits,
    },
    validatorSet: {
      threshold: 2,
      pubkeys: ['31', '32', '33'].map((byte) => `0x${byte.repeat(48)}`),
    },
    bridgePolicy: {
      policyVersion: 2,
      policyHash: HASH('41'),
      initialCoinCount: 32,
      lowWaterMark: 8,
      parentCoinIds: Array.from({ length: 32 }, (_, index) =>
        HASH((index + 64).toString(16).padStart(2, '0')),
      ),
      bridgeCoinIds: Array.from({ length: 32 }, (_, index) =>
        HASH((index + 96).toString(16).padStart(2, '0')),
      ),
    },
    canonicalVaultParamsHash: HASH('42'),
    evmAddresses: {
      forwarder: ADDRESS('51'),
      verifierAdapter: ADDRESS('52'),
      attestationEmitter: ADDRESS('53'),
    },
    signaturePolicy: {
      type: 'SolslotGenesisArtifact',
      threshold: 2,
      policy: 'owner-plus-one',
      ownerIndex: 0,
      coadminIndices: [1, 2],
      coadminThreshold: 1,
      rosterHash: HASH('26'),
    },
    retiredCoordinates: [HASH('ff')],
    signatures: [],
  } as SolslotPublicArtifact;
  if (identityChain !== undefined) {
    artifact.sourceManifestVersion = 4;
    const activation: EnrollmentActivation = {
      schema: evmChainId === 8453 ? 'solslot.enrollment-activation.v2' : 'solslot.enrollment-activation.v1', environment: environment.zkPassport.domain === 'solslot.com' ? 'production-alpha' : 'staging-alpha',
      network: 'testnet11', evmChainId: identityChain, deploymentId: artifact.ceremony.ceremonyId,
      sourceShas: {...artifact.sourceShas}, releaseIdentity: hashJson({schema:'solslot.enrollment-release.v1',sourceShas:artifact.sourceShas}),
      emitter: artifact.evmAddresses.attestationEmitter, issuer: ADDRESS('e1'),
      issuerKeyRef: 'https://example-vault.vault.azure.net/keys/enrollment/' + 'a'.repeat(32),
      issuerIdentityClientId: '11111111-1111-1111-1111-111111111111',
      permitVersion: 1, adapterVersion: 1, validatorMessageVersion: 1, bridgeModuleHash: BRIDGE_MODULE_HASH,
      contextHash: '', bridgePolicyHash: '', permitLifetimeSeconds: 900, reviewEvidenceSha256: 'b'.repeat(64),
    };
    activation.contextHash = activationContext(activation);
    activation.bridgePolicyHash = permitBridgePolicy(artifact.validatorSet.pubkeys, activation.contextHash);
    artifact.bridgePolicy.policyHash = activation.bridgePolicyHash;
    artifact.puzzleHashes['bridgePolicy'] = activation.bridgePolicyHash;
    artifact.enrollmentActivation = activation;
    artifact.genesisPlan = {enrollmentActivation: structuredClone(activation)};
  }
  artifact.artifactHash = await canonicalArtifactHash(artifact);
  const value = {
    artifactHash: artifact.artifactHash,
    ceremonyId: artifact.ceremony.ceremonyId,
    planHash: artifact.ceremony.planHash,
    network: artifact.network,
  };
  artifact.signatures = await Promise.all(
    slots.map(async (index) => ({
      adminIndex: index,
      compressedPubkey: artifact.adminAuthority.compressedPubkeys[index],
      signature: await wallets[index].signTypedData(
        { name: 'Solslot Protocol', version: '4', chainId: evmChainId },
        {
          SolslotGenesisArtifact: [
            { name: 'artifactHash', type: 'bytes32' },
            { name: 'ceremonyId', type: 'bytes32' },
            { name: 'planHash', type: 'bytes32' },
            { name: 'network', type: 'string' },
          ],
        },
        value,
      ),
    })),
  );
  return artifact;
}

describe('SolslotProtocolArtifactService', () => {
  afterEach(() => {
    environment.eip712ChainId = originalOperationalChain;
    Object.assign(environment.solslotProtocol, originalProtocol);
    Object.assign(environment.zkPassport, originalZkPassport);
    clearVerifiedProtocolCoordinates();
  });

  for (const chainId of [84532, 1, 8453]) {
    it(`rejects unselected Base Sepolia and mainnet artifacts: ${chainId}`, async () => {
      const artifact = await signedArtifact([0, 2], chainId);
      const vaultSignatureChain = environment.eip712ChainId;
      Object.assign(environment.solslotProtocol, {artifactHash: artifact.artifactHash, adminPortalSourceSha: SOURCE_SHA});
      const api = jasmine.createSpyObj<SolslotApiService>('SolslotApiService', ['getSignedProtocolArtifact']);
      api.getSignedProtocolArtifact.and.resolveTo(artifact);
      const service = new SolslotProtocolArtifactService(api);
      await service.initialize();
      expect(service.isReady).toBeFalse();
      expect(environment.eip712ChainId).toBe(vaultSignatureChain);
    });
  }

  it('keeps the historical source-manifest-v4 Ethereum Sepolia artifact readable without activation', async () => {
    const artifact = await signedArtifact([0, 2], 11155111, undefined, 4);
    Object.assign(environment.solslotProtocol, {artifactHash: artifact.artifactHash, adminPortalSourceSha: SOURCE_SHA});
    const api = jasmine.createSpyObj<SolslotApiService>('API', ['getSignedProtocolArtifact']);
    api.getSignedProtocolArtifact.and.resolveTo(artifact);
    const service = new SolslotProtocolArtifactService(api);
    await service.initialize();
    expect(service.isReady).withContext(service.failure).toBeTrue();
    expect(environment.zkPassport.evmChainId).toBe(11155111);
  });

  for (const identityChain of [8453, 84532] as const) it(`installs selected identity chain ${identityChain} without changing ceremony or recovery domains`, async () => {
    const artifact = await signedArtifact([0, 2], 84532, identityChain);
    const vaultSignatureChain = environment.eip712ChainId;
    Object.assign(environment.solslotProtocol, {artifactHash: artifact.artifactHash, adminPortalSourceSha: SOURCE_SHA});
    const api = jasmine.createSpyObj<SolslotApiService>('API', ['getSignedProtocolArtifact']);
    api.getSignedProtocolArtifact.and.resolveTo(artifact);
    const service = new SolslotProtocolArtifactService(api);
    await service.initialize();
    expect(service.isReady).withContext(service.failure).toBeTrue();
    expect(service.artifact?.evmChainId).toBe(84532);
    expect(environment.zkPassport.evmChainId).toBe(identityChain);
    expect(environment.eip712ChainId).toBe(vaultSignatureChain);
  });

  it('installs explicitly signed Base mainnet operations with Chia Testnet11', async () => {
    const artifact = await signedArtifact([0, 2], 8453, 8453);
    Object.assign(environment.solslotProtocol, {artifactHash: artifact.artifactHash, adminPortalSourceSha: SOURCE_SHA});
    const api = jasmine.createSpyObj<SolslotApiService>('API', ['getSignedProtocolArtifact']);
    api.getSignedProtocolArtifact.and.resolveTo(artifact);
    const service = new SolslotProtocolArtifactService(api);
    await service.initialize();
    expect(service.isReady).withContext(service.failure).toBeTrue();
    expect(service.artifact?.network).toBe('testnet11');
    expect(environment.eip712ChainId).toBe(8453);
    expect(environment.zkPassport.evmChainId).toBe(8453);
  });

  it('accepts production-hosted identity activation in the locked Testnet11 ceremony build only', async () => {
    expect(ceremonyLockedEnvironment.zkPassport.domain).toBe('solslot.com');
    expect(ceremonyLockedEnvironment.chiaNetwork).toBe('testnet11');
    expect(ceremonyLockedEnvironment.experienceMode).toBe('testnet-alpha');
    expect(ceremonyLockedEnvironment.eip712ChainId).toBe(stagingEnvironment.eip712ChainId);
    expect(ceremonyLockedEnvironment.protocolWritesEnabled).toBeFalse();
    environment.zkPassport.domain = ceremonyLockedEnvironment.zkPassport.domain;
    environment.zkPassport.deploymentEnvironment = ceremonyLockedEnvironment.zkPassport.deploymentEnvironment;
    const artifact = await signedArtifact([0, 2], 84532, 8453);
    Object.assign(environment.solslotProtocol, {artifactHash: artifact.artifactHash, adminPortalSourceSha: SOURCE_SHA});
    const api = jasmine.createSpyObj<SolslotApiService>('API', ['getSignedProtocolArtifact']);
    api.getSignedProtocolArtifact.and.resolveTo(artifact);
    const service = new SolslotProtocolArtifactService(api);
    await service.initialize();
    expect(service.isReady).withContext(service.failure).toBeTrue();
    const {INVENTORY_V2_HASH, RESERVED_V5_HASH} = await import('./mint-proposal-v2/inventory-puzzles');
    const inventoryArtifact = structuredClone(artifact);
    inventoryArtifact.inventoryActivation = {
      schema: 'solslot.inventory-activation.v1', network: 'testnet11', environment: 'production-alpha',
      deploymentId: artifact.ceremony.ceremonyId, inventoryVersion: 2, adapterVersion: 1,
      availableModuleHash: INVENTORY_V2_HASH, reservedModuleHash: RESERVED_V5_HASH,
      sourceShas: {...artifact.sourceShas}, reviewEvidenceSha256: 'ab'.repeat(32),
    };
    expect(() => verifyInventoryActivation(inventoryArtifact)).not.toThrow();
    inventoryArtifact.inventoryActivation.environment = 'staging-alpha';
    expect(() => verifyInventoryActivation(inventoryArtifact)).toThrowError(/does not match/);
    environment.zkPassport.domain = 'staging.solslot.com';
    await service.initialize();
    expect(service.isReady).toBeFalse();
    expect(service.failure).toContain('configuration disagree');
    environment.zkPassport.deploymentEnvironment = 'staging-alpha';
    await service.initialize();
    expect(service.isReady).toBeFalse();
    expect(service.failure).toContain('another host');
  });

  it('matches the independent Python/CLVM Base identity vector', () => {
    const vector = baseIdentityVector as any;
    expect(activationContext(vector.context)).toBe(vector.permit.contextHash);
    expect(permitBridgePolicy(vector.validatorPubkeys, vector.permit.contextHash)).toBe(vector.bridgePolicyHash);
  });

  for (const failure of ['chain', 'context', 'projection', 'missing', 'host', 'operational_mainnet']) it(`rejects mismatched identity activation: ${failure}`, async () => {
    const artifact = await signedArtifact([0, 2], 84532, 8453);
    if (failure === 'chain') (artifact.enrollmentActivation as any).evmChainId = 1;
    if (failure === 'context') artifact.enrollmentActivation!.contextHash = HASH('00');
    if (failure === 'projection') artifact.genesisPlan!['enrollmentActivation'] = null;
    if (failure === 'missing') delete artifact.enrollmentActivation;
    if (failure === 'host') {
      expect(() => artifactActivation(artifact, 'unrelated.solslot.com')).toThrowError(/another host/);
      return;
    }
    if (failure === 'operational_mainnet') (artifact as any).evmChainId = 8453;
    expect(() => artifactActivation(artifact)).toThrow();
  });

  it('accepts a source-pinned owner-plus-one artifact and installs runtime authority', async () => {
    const artifact = await signedArtifact();
    Object.assign(environment.solslotProtocol, {
      artifactHash: artifact.artifactHash,
      adminPortalSourceSha: SOURCE_SHA,
    });
    const api = jasmine.createSpyObj<SolslotApiService>('SolslotApiService', [
      'getSignedProtocolArtifact',
    ]);
    api.getSignedProtocolArtifact.and.resolveTo(artifact);
    const service = new SolslotProtocolArtifactService(api);

    await service.initialize();

    expect(service.isReady).toBeTrue();
    expect(protocolCoordinateFromEnvironment('poolLauncherId')).toBe(artifact.launcherIds.pool);
    expect(environment.zkPassport.validatorThreshold).toBe(2);
    expect(environment.solslotProtocol.adminAuthorityV2AdminPubkeys).toEqual(
      artifact.adminAuthority.compressedPubkeys,
    );
    expect(environment.solslotProtocol.propertyRegistryLauncherId).toBe(
      artifact.launcherIds.propertyRegistry,
    );
    expect(environment.solslotProtocol.protocolDidSingletonStructHex).toBe(
      artifact.protocolDid.singletonStruct,
    );
    expect(environment.solslotProtocol.governanceSingletonStructHex).toBe(
      artifact.governanceStruct.serialized,
    );
  });

  it('does not fetch an artifact when release pins are absent', async () => {
    Object.assign(environment.solslotProtocol, {
      artifactHash: '',
      adminPortalSourceSha: '',
    });
    const api = jasmine.createSpyObj<SolslotApiService>('SolslotApiService', [
      'getSignedProtocolArtifact',
    ]);
    const service = new SolslotProtocolArtifactService(api);

    await service.initialize();

    expect(service.isReady).toBeFalse();
    expect(api.getSignedProtocolArtifact).not.toHaveBeenCalled();
    expect(protocolCoordinateFromEnvironment('poolLauncherId')).toBeUndefined();
  });

  it('rejects an artifact using the retired source-manifest version', async () => {
    const artifact = await signedArtifact();
    Object.assign(environment.solslotProtocol, {
      artifactHash: artifact.artifactHash,
      adminPortalSourceSha: SOURCE_SHA,
    });
    (artifact as { sourceManifestVersion: number }).sourceManifestVersion = 2;
    const api = jasmine.createSpyObj<SolslotApiService>('SolslotApiService', [
      'getSignedProtocolArtifact',
    ]);
    api.getSignedProtocolArtifact.and.resolveTo(artifact);
    const service = new SolslotProtocolArtifactService(api);

    await service.initialize();

    expect(service.isReady).toBeFalse();
    expect(service.failure).toContain('does not describe Solslot V2 testnet11');
  });

  it('clears runtime authority when administrator quorum is invalid', async () => {
    const artifact = await signedArtifact();
    Object.assign(environment.solslotProtocol, {
      artifactHash: artifact.artifactHash,
      adminPortalSourceSha: SOURCE_SHA,
    });
    artifact.signatures = [];
    const api = jasmine.createSpyObj<SolslotApiService>('SolslotApiService', [
      'getSignedProtocolArtifact',
    ]);
    api.getSignedProtocolArtifact.and.resolveTo(artifact);
    const service = new SolslotProtocolArtifactService(api);

    await service.initialize();

    expect(service.isReady).toBeFalse();
    expect(service.failure).toContain('slot 0 and one valid coadmin');
    expect(protocolCoordinateFromEnvironment('poolLauncherId')).toBeUndefined();
  });

  it('rejects signatures from both coadmins when slot 0 did not sign', async () => {
    const artifact = await signedArtifact([1, 2]);
    Object.assign(environment.solslotProtocol, {
      artifactHash: artifact.artifactHash,
      adminPortalSourceSha: SOURCE_SHA,
    });
    const api = jasmine.createSpyObj<SolslotApiService>('SolslotApiService', [
      'getSignedProtocolArtifact',
    ]);
    api.getSignedProtocolArtifact.and.resolveTo(artifact);
    const service = new SolslotProtocolArtifactService(api);

    await service.initialize();

    expect(service.isReady).toBeFalse();
    expect(service.failure).toContain('slot 0 and one valid coadmin');
  });
});
