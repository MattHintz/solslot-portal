import { Injectable, inject } from '@angular/core';
import { sha256 } from 'ethers';

import { BootstrapRecoveryAnchorArtifact } from './admin-bootstrap.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinRecord, CoinsetService } from './coinset.service';
import { bytesToHex, coinId, hexToBytes } from '../utils/chia-hash';

export const RECOVERY_ANCHOR_TAG = 'POPULIS_BOOTSTRAP_V1';
export const RECOVERY_ANCHOR_MARKER_AMOUNT_MOJOS = 1;

@Injectable({ providedIn: 'root' })
export class RecoveryAnchorDiscoveryService {
  private readonly coinset = inject(CoinsetService);
  private readonly chiaWasm = inject(ChiaWasmService);

  async discoverAnchors(args: RecoveryAnchorDiscoveryArgs = {}): Promise<RecoveryAnchorDiscoveryReport> {
    const tagMemoHex = utf8ToHex(RECOVERY_ANCHOR_TAG);
    const candidates = await this.coinset.getCoinRecordsByHint(tagMemoHex, true);
    const sorted = [...candidates].sort((a, b) => {
      const byHeight = b.confirmed_block_index - a.confirmed_block_index;
      if (byHeight !== 0) return byHeight;
      return b.timestamp - a.timestamp;
    });
    const anchors: DiscoveredRecoveryAnchor[] = [];
    const rejectedCandidates: RejectedRecoveryAnchorCandidate[] = [];

    for (const candidate of sorted) {
      const markerCoinId = coinId(
        candidate.coin.parent_coin_info,
        candidate.coin.puzzle_hash,
        candidate.coin.amount,
      );
      try {
        const anchor = await this.decodeCandidate(candidate, tagMemoHex);
        if (args.network && anchor.bootstrapRecoveryAnchor.network !== args.network) {
          continue;
        }
        if (
          args.adminAuthorityV2LauncherId &&
          normalizeHex(anchor.bootstrapRecoveryAnchor.admin_authority_v2_launcher_id) !==
            normalizeHex(args.adminAuthorityV2LauncherId)
        ) {
          continue;
        }
        anchors.push(anchor);
        if (args.limit !== undefined && anchors.length >= args.limit) {
          break;
        }
      } catch (err) {
        rejectedCandidates.push({
          markerCoinId,
          parentCoinId: normalizeHex(candidate.coin.parent_coin_info),
          confirmedBlockIndex: candidate.confirmed_block_index,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      tagMemoUtf8: RECOVERY_ANCHOR_TAG,
      tagMemoHex,
      scannedCandidateCount: candidates.length,
      anchors,
      rejectedCandidates,
    };
  }

  private async decodeCandidate(
    candidate: CoinRecord,
    tagMemoHex: string,
  ): Promise<DiscoveredRecoveryAnchor> {
    if (candidate.coin.amount !== RECOVERY_ANCHOR_MARKER_AMOUNT_MOJOS) {
      throw new Error(
        `candidate amount ${candidate.coin.amount} is not the recovery marker amount`,
      );
    }

    const parentCoinId = normalizeHex(candidate.coin.parent_coin_info);
    const parentSpend = await this.coinset.getPuzzleAndSolution(
      parentCoinId,
      candidate.confirmed_block_index,
    );
    if (!parentSpend) {
      throw new Error('parent spend puzzle/solution unavailable');
    }

    const condition = this.findMarkerCreateCoinCondition({
      parentSpend,
      markerPuzzleHash: candidate.coin.puzzle_hash,
      markerAmount: candidate.coin.amount,
      tagMemoHex,
    });
    const payloadMemoUtf8 = bytesToUtf8(condition.payloadMemoBytes);
    const parsed = parseJsonRecord(payloadMemoUtf8);
    const bootstrapRecoveryAnchor = validateRecoveryAnchorPayload(parsed);
    const canonicalPayloadMemoUtf8 = canonicalJson(bootstrapRecoveryAnchor);
    if (payloadMemoUtf8 !== canonicalPayloadMemoUtf8) {
      throw new Error('recovery anchor payload memo is not canonical JSON');
    }
    const payloadHash = contentHash(bootstrapRecoveryAnchor);
    const markerCoinId = coinId(
      candidate.coin.parent_coin_info,
      candidate.coin.puzzle_hash,
      candidate.coin.amount,
    );

    return {
      markerCoinId,
      parentCoinId,
      markerPuzzleHash: normalizeHex(candidate.coin.puzzle_hash),
      markerCoinAmountMojos: candidate.coin.amount,
      confirmedBlockIndex: candidate.confirmed_block_index,
      spentBlockIndex: candidate.spent_block_index,
      timestamp: candidate.timestamp,
      tagMemoUtf8: RECOVERY_ANCHOR_TAG,
      payloadMemoUtf8,
      payloadHash,
      bootstrapRecoveryAnchor,
    };
  }

  private findMarkerCreateCoinCondition(args: {
    parentSpend: {
      puzzleReveal: string;
      solution: string;
    };
    markerPuzzleHash: string;
    markerAmount: number;
    tagMemoHex: string;
  }): { payloadMemoBytes: Uint8Array } {
    const sdk = this.chiaWasm.sdk();
    const ClvmCtor = sdk['Clvm'] as
      | (new () => {
          deserialize: (b: Uint8Array) => ProgramShape;
        })
      | undefined;
    if (typeof ClvmCtor !== 'function') {
      throw new Error('chia-wallet-sdk-wasm Clvm helper missing');
    }

    const markerPuzzleHashBytes = hexToBytes(args.markerPuzzleHash);
    const tagMemoBytes = hexToBytes(args.tagMemoHex);
    let conditions: ProgramShape;
    try {
      const clvm = new ClvmCtor();
      const puzzle = clvm.deserialize(hexToBytes(args.parentSpend.puzzleReveal));
      const solution = clvm.deserialize(hexToBytes(args.parentSpend.solution));
      const output = (
        puzzle as unknown as {
          run: (s: ProgramShape, c: number, m: boolean) => { value: ProgramShape };
        }
      ).run(solution, 11_000_000, false);
      conditions = output.value;
    } catch (err) {
      throw new Error(
        `parent spend replay failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const conditionList = toProgramList(conditions);
    if (conditionList === null) {
      throw new Error('parent spend did not return a condition list');
    }

    for (const condition of conditionList) {
      const fields = toProgramList(condition);
      if (fields === null || fields.length < 4) continue;
      const opcode = toAtom(fields[0]);
      if (opcode === null || opcode.length !== 1 || opcode[0] !== 51) continue;
      const puzzleHash = toAtom(fields[1]);
      if (puzzleHash === null || !bytesEqual(puzzleHash, markerPuzzleHashBytes)) continue;
      const amount = toAtom(fields[2]);
      if (amount === null || atomToBigInt(amount) !== BigInt(args.markerAmount)) continue;
      const memos = toProgramList(fields[3]);
      if (memos === null || memos.length !== 2) continue;
      const tagMemo = toAtom(memos[0]);
      const payloadMemo = toAtom(memos[1]);
      if (tagMemo === null || payloadMemo === null) continue;
      if (!bytesEqual(tagMemo, tagMemoBytes)) continue;
      return { payloadMemoBytes: payloadMemo };
    }

    throw new Error('parent spend does not create a recovery anchor marker coin');
  }
}

export interface RecoveryAnchorDiscoveryArgs {
  network?: string;
  adminAuthorityV2LauncherId?: string;
  limit?: number;
}

export interface RecoveryAnchorDiscoveryReport {
  tagMemoUtf8: string;
  tagMemoHex: string;
  scannedCandidateCount: number;
  anchors: DiscoveredRecoveryAnchor[];
  rejectedCandidates: RejectedRecoveryAnchorCandidate[];
}

export interface DiscoveredRecoveryAnchor {
  markerCoinId: string;
  parentCoinId: string;
  markerPuzzleHash: string;
  markerCoinAmountMojos: number;
  confirmedBlockIndex: number;
  spentBlockIndex: number;
  timestamp: number;
  tagMemoUtf8: string;
  payloadMemoUtf8: string;
  payloadHash: string;
  bootstrapRecoveryAnchor: BootstrapRecoveryAnchorArtifact;
}

export interface RejectedRecoveryAnchorCandidate {
  markerCoinId: string;
  parentCoinId: string;
  confirmedBlockIndex: number;
  reason: string;
}

interface ProgramShape {
  toAtom?: () => Uint8Array;
  toList?: () => ProgramShape[];
}

function validateRecoveryAnchorPayload(value: Record<string, unknown>): BootstrapRecoveryAnchorArtifact {
  const payload = { ...value };
  if (payload['version'] !== 1) {
    throw new Error('recovery anchor version must be 1');
  }
  if (payload['tag'] !== RECOVERY_ANCHOR_TAG) {
    throw new Error('recovery anchor tag mismatch');
  }
  const network = requireString(payload, 'network');
  const adminLauncher = requireHex32(payload, 'admin_authority_v2_launcher_id');
  const authorityVersion = payload['authority_version'];
  if (!Number.isInteger(authorityVersion) || Number(authorityVersion) < 1) {
    throw new Error('authority_version must be a positive integer');
  }
  return {
    version: 1,
    tag: RECOVERY_ANCHOR_TAG,
    network,
    admin_authority_v2_launcher_id: adminLauncher,
    authority_version: Number(authorityVersion),
    bootstrap_manifest_hash: requireSha256Hash(payload, 'bootstrap_manifest_hash'),
    portal_runtime_config_hash: requireSha256Hash(payload, 'portal_runtime_config_hash'),
    admin_records_hash: requireSha256Hash(payload, 'admin_records_hash'),
  };
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function requireHex32(obj: Record<string, unknown>, key: string): string {
  const value = requireString(obj, key);
  const normalized = normalizeHex(value);
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${key} must be a 32-byte hex string`);
  }
  return normalized;
}

function requireSha256Hash(obj: Record<string, unknown>, key: string): string {
  const value = requireString(obj, key).toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${key} must be a sha256: content hash`);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value: unknown): string {
  const digest = sha256(new TextEncoder().encode(canonicalJson(value)));
  return `sha256:${digest.slice(2)}`;
}

function utf8ToHex(value: string): string {
  return bytesToHex(new TextEncoder().encode(value));
}

function bytesToUtf8(value: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(value);
}

function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('recovery anchor payload memo must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function normalizeHex(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X')
    ? `0x${value.slice(2).toLowerCase()}`
    : `0x${value.toLowerCase()}`;
}

function toProgramList(node: ProgramShape | undefined): ProgramShape[] | null {
  if (!node || typeof node.toList !== 'function') return null;
  try {
    return node.toList();
  } catch {
    return null;
  }
}

function toAtom(node: ProgramShape | undefined): Uint8Array | null {
  if (!node || typeof node.toAtom !== 'function') return null;
  try {
    return node.toAtom();
  } catch {
    return null;
  }
}

function atomToBigInt(atom: Uint8Array): bigint {
  let value = 0n;
  for (const byte of atom) {
    value = (value << 8n) + BigInt(byte);
  }
  return value;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
