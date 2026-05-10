import { Injectable } from '@angular/core';
import { Interface, JsonRpcProvider } from 'ethers';

import { environment } from '../../environments/environment';
import { bytesToHex, coinId, hexToBytes } from '../utils/chia-hash';
import { ZkPassportAttestationService, ZKPASSPORT_POLICY_VERSION } from './zkpassport-attestation.service';

const EVENT_ABI = [
  'event VaultAttestationVerified(address indexed sender, bytes32 indexed vaultLauncherId, bytes32 indexed scopedNullifier, uint16 nullifierType, bytes32 serviceScopeHash, bytes32 serviceSubscopeHash, uint64 proofTimestamp, bytes32 attestationLeafHash, bytes32 attestationRoot, bytes32 bridgeParentId, uint64 bridgeAmount, bytes32 bridgeCoinId, bytes32 bridgeMessage, bytes32 bridgePolicyHash, uint16 policyVersion)',
];
const EVENT_IFACE = new Interface(EVENT_ABI);

export interface ZkPassportRawAttestationEvent {
  sender: string;
  vaultLauncherId: string;
  scopedNullifier: string;
  nullifierType: number;
  serviceScopeHash: string;
  serviceSubscopeHash: string;
  proofTimestamp: number;
  attestationLeafHash: string;
  attestationRoot: string;
  bridgeParentId: string;
  bridgeAmount: number;
  bridgeCoinId: string;
  bridgeMessage: string;
  bridgePolicyHash: string;
  policyVersion: number;
  transactionHash?: string;
  blockNumber?: number;
}

export interface ZkPassportDerivedEnrollment {
  vaultLauncherId: string;
  vaultSubscope: string;
  scopedNullifier: string;
  nullifierType: number;
  serviceScopeHash: string;
  serviceSubscopeHash: string;
  proofTimestamp: number;
  attestationLeafHash: string;
  newIdentityAttestRoot: string;
  attestationProof: { bitpath: number; siblings: string[] };
  bridgePolicyHash: string;
  bridgeParentId: string;
  bridgeAmount: number;
  bridgeCoinId: string;
  bridgeMessage: string;
  bridgeAnnouncementPayload: string;
  validatorMessage: string;
}

export interface ValidatorBridgeSignature {
  validatorPubkey: string;
  signature: string;
}

export interface ValidatorBridgeConfig {
  validatorPubkeys: string[];
  validatorThreshold: number;
  bridgeParentId?: string;
  bridgeAmount?: number;
}

export interface ValidatorBridgeSpendPackage {
  status: 'insufficient_signatures' | 'threshold_ready';
  backendSigning: false;
  requiredSignatures: number;
  signerIndices: number[];
  validatorMessage: string;
  signatures: ValidatorBridgeSignature[];
  bridgeCoin: {
    parentId: string;
    puzzleHash: string;
    amount: number;
    coinId: string;
  };
}

export type ZkPassportEvmPollResult =
  | { kind: 'pending'; checkedAtMs: number }
  | { kind: 'timeout'; checkedAtMs: number; elapsedMs: number }
  | { kind: 'malformed'; checkedAtMs: number; reason: string; event?: ZkPassportRawAttestationEvent }
  | {
      kind: 'found';
      checkedAtMs: number;
      event: ZkPassportRawAttestationEvent;
      enrollment: ZkPassportDerivedEnrollment;
      bridgeSpendPackage: ValidatorBridgeSpendPackage;
    };

export interface ZkPassportAttestationEventSource {
  latestVaultAttestation(vaultLauncherId: string): Promise<ZkPassportRawAttestationEvent | null>;
}

export interface PollOnceOptions {
  source?: ZkPassportAttestationEventSource;
  nowMs?: number;
  startedAtMs?: number;
  timeoutMs?: number;
  validatorSignatures?: ValidatorBridgeSignature[];
  bridgeConfig?: ValidatorBridgeConfig;
}

@Injectable({ providedIn: 'root' })
export class ZkPassportEvmAttestationPollerService {
  constructor(private readonly attestation: ZkPassportAttestationService) {}

  async pollOnce(vaultLauncherId: string, options: PollOnceOptions = {}): Promise<ZkPassportEvmPollResult> {
    const checkedAtMs = options.nowMs ?? Date.now();
    const timeoutMs = options.timeoutMs ?? environment.zkPassport.evmPollTimeoutMs;
    const startedAtMs = options.startedAtMs;
    if (startedAtMs !== undefined && checkedAtMs - startedAtMs >= timeoutMs) {
      return { kind: 'timeout', checkedAtMs, elapsedMs: checkedAtMs - startedAtMs };
    }
    const source = options.source ?? this.defaultSource();
    const event = await source.latestVaultAttestation(vaultLauncherId);
    if (!event) {
      return { kind: 'pending', checkedAtMs };
    }
    const derived = this.deriveEnrollmentFromEvent(event, vaultLauncherId, options.bridgeConfig);
    if (derived.kind === 'malformed') {
      return { kind: 'malformed', checkedAtMs, reason: derived.reason, event };
    }
    return {
      kind: 'found',
      checkedAtMs,
      event,
      enrollment: derived.enrollment,
      bridgeSpendPackage: this.assembleBridgeSpendPackage(
        derived.enrollment,
        options.validatorSignatures ?? [],
        options.bridgeConfig,
      ),
    };
  }

  proofLaunchUrl(vaultLauncherId: string): string | null {
    const base = environment.zkPassport.verificationUrl;
    if (!base) {
      return null;
    }
    const url = new URL(base, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
    url.searchParams.set('scope', 'populis.app');
    url.searchParams.set('custom_data', this.attestation.computeVaultSubscope(vaultLauncherId));
    return url.toString();
  }

  deriveEnrollmentFromEvent(
    raw: ZkPassportRawAttestationEvent,
    expectedVaultLauncherId: string,
    bridgeConfig: Partial<ValidatorBridgeConfig> = {},
  ): { kind: 'ok'; enrollment: ZkPassportDerivedEnrollment } | { kind: 'malformed'; reason: string } {
    try {
      const event = normalizeEvent(raw);
      const expectedLauncher = normalizeHex(expectedVaultLauncherId, 'vaultLauncherId', 32);
      if (event.vaultLauncherId !== expectedLauncher) {
        return { kind: 'malformed', reason: 'event vault launcher id does not match active vault' };
      }
      if (event.policyVersion !== ZKPASSPORT_POLICY_VERSION) {
        return { kind: 'malformed', reason: 'event policy version is not supported' };
      }
      const leaf = this.attestation.computeAttestationLeaf(event);
      if (leaf !== event.attestationLeafHash) {
        return { kind: 'malformed', reason: 'event attestation leaf hash does not match commitments' };
      }
      const root = this.attestation.computeAttestationRoot([leaf]);
      if (root !== event.attestationRoot) {
        return { kind: 'malformed', reason: 'event attestation root does not match the supported single-leaf root' };
      }
      const bridgeMessage = this.attestation.computeAttestationBridgeMessage({
        vaultLauncherId: event.vaultLauncherId,
        attestationRoot: root,
        bridgePolicyHash: event.bridgePolicyHash,
      });
      if (bridgeMessage !== event.bridgeMessage) {
        return { kind: 'malformed', reason: 'event bridge message does not match commitments' };
      }
      const bridgeCoinId = coinId(event.bridgeParentId, event.bridgePolicyHash, event.bridgeAmount);
      if (bridgeCoinId !== event.bridgeCoinId) {
        return { kind: 'malformed', reason: 'event bridge coin id does not match parent, policy, and amount' };
      }
      if (bridgeConfig.bridgeParentId) {
        const expectedBridgeParentId = normalizeHex(bridgeConfig.bridgeParentId, 'bridgeParentId', 32);
        if (event.bridgeParentId !== expectedBridgeParentId) {
          return { kind: 'malformed', reason: 'event bridge parent id does not match configured bridge parent' };
        }
      }
      if (bridgeConfig.bridgeAmount !== undefined && event.bridgeAmount !== bridgeConfig.bridgeAmount) {
        return { kind: 'malformed', reason: 'event bridge amount does not match configured bridge amount' };
      }
      const validatorMessage = this.attestation.computeValidatorBridgeMessage({
        vaultLauncherId: event.vaultLauncherId,
        attestationRoot: root,
        bridgePolicyHash: event.bridgePolicyHash,
        bridgeCoinId: event.bridgeCoinId,
        bridgeMessage,
        attestationLeafHash: leaf,
        scopedNullifier: event.scopedNullifier,
        nullifierType: event.nullifierType,
        serviceScopeHash: event.serviceScopeHash,
        serviceSubscopeHash: event.serviceSubscopeHash,
        proofTimestamp: event.proofTimestamp,
      });
      return {
        kind: 'ok',
        enrollment: {
          vaultLauncherId: event.vaultLauncherId,
          vaultSubscope: this.attestation.computeVaultSubscope(event.vaultLauncherId),
          scopedNullifier: event.scopedNullifier,
          nullifierType: event.nullifierType,
          serviceScopeHash: event.serviceScopeHash,
          serviceSubscopeHash: event.serviceSubscopeHash,
          proofTimestamp: event.proofTimestamp,
          attestationLeafHash: leaf,
          newIdentityAttestRoot: root,
          attestationProof: {
            bitpath: this.attestation.singleLeafProof().bitpath,
            siblings: [],
          },
          bridgePolicyHash: event.bridgePolicyHash,
          bridgeParentId: event.bridgeParentId,
          bridgeAmount: event.bridgeAmount,
          bridgeCoinId: event.bridgeCoinId,
          bridgeMessage,
          bridgeAnnouncementPayload: `0x50${bridgeMessage.slice(2)}`,
          validatorMessage,
        },
      };
    } catch (err) {
      return { kind: 'malformed', reason: err instanceof Error ? err.message : String(err) };
    }
  }

  assembleBridgeSpendPackage(
    enrollment: ZkPassportDerivedEnrollment,
    signatures: ValidatorBridgeSignature[],
    bridgeConfig: Partial<ValidatorBridgeConfig> = {},
  ): ValidatorBridgeSpendPackage {
    const configuredPubkeys: string[] = bridgeConfig.validatorPubkeys ?? environment.zkPassport.validatorPubkeys;
    const validatorPubkeys = configuredPubkeys.map((pubkey: string, index: number) =>
      normalizeHex(pubkey, `validatorPubkeys[${index}]`, 48),
    );
    const configuredThreshold = bridgeConfig.validatorThreshold ?? environment.zkPassport.validatorThreshold;
    const requiredSignatures = configuredThreshold > 0 ? configuredThreshold : 1;
    if (validatorPubkeys.length > 0) {
      assertPositiveInteger(requiredSignatures, 'validatorThreshold');
    }
    if (validatorPubkeys.length > 0 && requiredSignatures > validatorPubkeys.length) {
      throw new Error('validatorThreshold exceeds validatorPubkeys length');
    }
    const byPubkey = new Map<string, number>(
      validatorPubkeys.map((pubkey: string, index: number) => [pubkey, index]),
    );
    const normalizedSignatures: ValidatorBridgeSignature[] = [];
    const signerIndices: number[] = [];
    const seen = new Set<number>();
    for (const signature of signatures) {
      const validatorPubkey = normalizeHex(signature.validatorPubkey, 'validatorPubkey', 48);
      const index = byPubkey.get(validatorPubkey);
      if (index === undefined || seen.has(index)) {
        continue;
      }
      seen.add(index);
      signerIndices.push(index);
      normalizedSignatures.push({
        validatorPubkey,
        signature: normalizeHex(signature.signature, 'signature', 96),
      });
    }
    signerIndices.sort((a, b) => a - b);
    normalizedSignatures.sort((a, b) => {
      const indexA = byPubkey.get(a.validatorPubkey) ?? 0;
      const indexB = byPubkey.get(b.validatorPubkey) ?? 0;
      return indexA - indexB;
    });
    return {
      status:
        validatorPubkeys.length > 0 && signerIndices.length >= requiredSignatures
          ? 'threshold_ready'
          : 'insufficient_signatures',
      backendSigning: false,
      requiredSignatures,
      signerIndices,
      validatorMessage: enrollment.validatorMessage,
      signatures: normalizedSignatures,
      bridgeCoin: {
        parentId: enrollment.bridgeParentId,
        puzzleHash: enrollment.bridgePolicyHash,
        amount: enrollment.bridgeAmount,
        coinId: enrollment.bridgeCoinId,
      },
    };
  }

  private defaultSource(): ZkPassportAttestationEventSource {
    return new EthersVaultAttestationEventSource(
      environment.zkPassport.evmRpcUrl,
      environment.zkPassport.attestationEmitterAddress,
      environment.zkPassport.attestationEmitterFromBlock,
    );
  }
}

class EthersVaultAttestationEventSource implements ZkPassportAttestationEventSource {
  constructor(
    private readonly rpcUrl: string,
    private readonly emitterAddress: string,
    private readonly fromBlock: number,
  ) {}

  async latestVaultAttestation(vaultLauncherId: string): Promise<ZkPassportRawAttestationEvent | null> {
    if (!this.rpcUrl || !this.emitterAddress) {
      return null;
    }
    const provider = new JsonRpcProvider(this.rpcUrl);
    const topics = EVENT_IFACE.encodeFilterTopics('VaultAttestationVerified', [
      null,
      normalizeHex(vaultLauncherId, 'vaultLauncherId', 32),
    ]);
    const logs = await provider.getLogs({
      address: this.emitterAddress,
      fromBlock: this.fromBlock,
      toBlock: 'latest',
      topics,
    });
    const log = logs
      .slice()
      .sort(
        (a, b) =>
          Number(a.blockNumber ?? 0) - Number(b.blockNumber ?? 0) ||
          Number(a.index ?? 0) - Number(b.index ?? 0),
      )
      .at(-1);
    return log ? decodeVaultAttestationLog(log) : null;
  }
}

function decodeVaultAttestationLog(log: {
  data: string;
  topics: readonly string[];
  transactionHash?: string;
  blockNumber?: number;
}): ZkPassportRawAttestationEvent {
  const decoded = EVENT_IFACE.decodeEventLog('VaultAttestationVerified', log.data, log.topics);
  return {
    sender: String(decoded['sender']),
    vaultLauncherId: String(decoded['vaultLauncherId']),
    scopedNullifier: String(decoded['scopedNullifier']),
    nullifierType: Number(decoded['nullifierType']),
    serviceScopeHash: String(decoded['serviceScopeHash']),
    serviceSubscopeHash: String(decoded['serviceSubscopeHash']),
    proofTimestamp: Number(decoded['proofTimestamp']),
    attestationLeafHash: String(decoded['attestationLeafHash']),
    attestationRoot: String(decoded['attestationRoot']),
    bridgeParentId: String(decoded['bridgeParentId']),
    bridgeAmount: Number(decoded['bridgeAmount']),
    bridgeCoinId: String(decoded['bridgeCoinId']),
    bridgeMessage: String(decoded['bridgeMessage']),
    bridgePolicyHash: String(decoded['bridgePolicyHash']),
    policyVersion: Number(decoded['policyVersion']),
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber,
  };
}

function normalizeEvent(raw: ZkPassportRawAttestationEvent): ZkPassportRawAttestationEvent {
  return {
    ...raw,
    vaultLauncherId: normalizeHex(raw.vaultLauncherId, 'vaultLauncherId', 32),
    scopedNullifier: normalizeHex(raw.scopedNullifier, 'scopedNullifier', 32),
    serviceScopeHash: normalizeHex(raw.serviceScopeHash, 'serviceScopeHash', 32),
    serviceSubscopeHash: normalizeHex(raw.serviceSubscopeHash, 'serviceSubscopeHash', 32),
    attestationLeafHash: normalizeHex(raw.attestationLeafHash, 'attestationLeafHash', 32),
    attestationRoot: normalizeHex(raw.attestationRoot, 'attestationRoot', 32),
    bridgeParentId: normalizeHex(raw.bridgeParentId, 'bridgeParentId', 32),
    bridgeAmount: assertPositiveInteger(raw.bridgeAmount, 'bridgeAmount'),
    bridgeCoinId: normalizeHex(raw.bridgeCoinId, 'bridgeCoinId', 32),
    bridgeMessage: normalizeHex(raw.bridgeMessage, 'bridgeMessage', 32),
    bridgePolicyHash: normalizeHex(raw.bridgePolicyHash, 'bridgePolicyHash', 32),
    nullifierType: assertNonNegativeInteger(raw.nullifierType, 'nullifierType'),
    proofTimestamp: assertNonNegativeInteger(raw.proofTimestamp, 'proofTimestamp'),
    policyVersion: assertNonNegativeInteger(raw.policyVersion, 'policyVersion'),
  };
}

function normalizeHex(value: string, field: string, expectedBytes: number): string {
  const withPrefix = value.startsWith('0x') ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]*$/.test(withPrefix)) {
    throw new Error(`${field} must be hex`);
  }
  const normalized = bytesToHex(hexToBytes(withPrefix));
  if (hexToBytes(normalized).length !== expectedBytes) {
    throw new Error(`${field} must be ${expectedBytes} bytes`);
  }
  return normalized.toLowerCase();
}

function assertNonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function assertPositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}
