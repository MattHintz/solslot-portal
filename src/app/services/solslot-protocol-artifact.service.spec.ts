import { SigningKey, Wallet } from 'ethers';
import { environment } from '../../environments/environment';
import { SolslotApiService, SolslotPublicArtifact } from './solslot-api.service';
import {
  canonicalArtifactHash,
  SolslotProtocolArtifactService,
} from './solslot-protocol-artifact.service';
import {
  clearVerifiedProtocolCoordinates,
  protocolCoordinateFromEnvironment,
} from './protocol-coordinate-guard';

const SOURCE_SHA = 'a'.repeat(40);
const HASH = (byte: string) => `0x${byte.repeat(32)}`;
const ADDRESS = (byte: string) => `0x${byte.repeat(20)}`;
const originalProtocol = { ...environment.solslotProtocol };
const originalZkPassport = { ...environment.zkPassport };

async function signedArtifact(): Promise<SolslotPublicArtifact> {
  const wallets = ['01', '02', '03'].map((byte) => new Wallet(`0x${byte.repeat(32)}`));
  const artifact = {
    schemaVersion: 2,
    protocolVersion: 'solslot-v2',
    network: 'testnet11',
    evmChainId: 11155111,
    reviewClass: 'internal-engineering-testnet',
    testOnly: true,
    auditStatus: 'unaudited',
    buildTimestamp: '2026-07-14T00:00:00+00:00',
    artifactHash: '',
    sourceShas: {
      protocol: '1'.repeat(40),
      evm: '2'.repeat(40),
      api: '3'.repeat(40),
      customerWeb: '4'.repeat(40),
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
      navRegistry: HASH('14'),
      protocolConfig: HASH('15'),
      adminAuthority: HASH('16'),
      vaultVersionRegistry: HASH('17'),
      propertyRegistry: HASH('18'),
    },
    puzzleHashes: {
      poolInnerPuzzleHash: HASH('21'),
      p2PoolModHash: HASH('22'),
      p2VaultModHash: HASH('24'),
      sgtTailHash: HASH('23'),
      didInnerPuzzleHash: HASH('25'),
      didFullPuzzleHash: HASH('26'),
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
      navRegistry: 1,
      protocolConfig: 1,
      adminAuthority: 2,
      vault: 2,
      propertyRegistry: 0,
    },
    adminAuthority: {
      threshold: 2,
      rosterHash: HASH('26'),
      mipsRootHash: HASH('27'),
      compressedPubkeys: wallets.map((wallet) =>
        SigningKey.computePublicKey(wallet.privateKey, true),
      ),
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
      rosterHash: HASH('26'),
    },
    retiredCoordinates: [HASH('ff')],
    signatures: [],
  } as SolslotPublicArtifact;
  artifact.artifactHash = await canonicalArtifactHash(artifact);
  const value = {
    artifactHash: artifact.artifactHash,
    ceremonyId: artifact.ceremony.ceremonyId,
    planHash: artifact.ceremony.planHash,
    network: artifact.network,
  };
  artifact.signatures = await Promise.all(
    [0, 2].map(async (index) => ({
      adminIndex: index,
      compressedPubkey: artifact.adminAuthority.compressedPubkeys[index],
      signature: await wallets[index].signTypedData(
        { name: 'Solslot Protocol', version: '2', chainId: 11155111 },
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
    Object.assign(environment.solslotProtocol, originalProtocol);
    Object.assign(environment.zkPassport, originalZkPassport);
    clearVerifiedProtocolCoordinates();
  });

  it('accepts a source-pinned 2-of-3 artifact and installs runtime authority', async () => {
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
    expect(service.failure).toContain('two valid administrator signatures');
    expect(protocolCoordinateFromEnvironment('poolLauncherId')).toBeUndefined();
  });
});
