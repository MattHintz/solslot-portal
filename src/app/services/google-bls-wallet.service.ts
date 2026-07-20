import { Injectable, inject, signal } from '@angular/core';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

import { environment } from '../../environments/environment';
import { bytesToHex, hexToBytes } from '../utils/chia-hash';
import { ChiaWasmService } from './chia-wasm.service';
import type { SignedSpendBundle, UnsignedCoinSpend } from './chia-wallet.service';
import { GOOGLE_VAULT_DERIVATION } from './vault-backup-crypto.service';

const MAX_BLOCK_COST_CLVM = 11_000_000_000n;

@Injectable({ providedIn: 'root' })
export class GoogleBlsWalletService {
  private readonly wasm = inject(ChiaWasmService);
  private secretKey: WasmSecretKey | null = null;
  private syntheticSecretKey: WasmSecretKey | null = null;

  readonly publicKey = signal<string | null>(null);
  readonly unlocked = signal(false);

  unlock(mnemonicValue: string, expectedPublicKey?: string): string {
    ensureGoogleVaultTestnet();
    const mnemonic = mnemonicValue.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!validateMnemonic(mnemonic, wordlist)) {
      throw new Error('The recovery phrase is invalid.');
    }
    const sdk = this.sdk();
    const seed = mnemonicToSeedSync(mnemonic);
    let masterSecretKey: WasmSecretKey | null = null;
    let secretKey: WasmSecretKey | null = null;
    let syntheticSecretKey: WasmSecretKey | null = null;
    try {
      masterSecretKey = sdk.SecretKey.fromSeed(seed);
      secretKey = masterSecretKey.deriveUnhardenedPath([...GOOGLE_VAULT_DERIVATION.path]);
      syntheticSecretKey = secretKey.deriveSynthetic();
      const publicKey = publicKeyHex(secretKey);
      if (expectedPublicKey && normalizeHex(expectedPublicKey) !== normalizeHex(publicKey)) {
        throw new Error('This recovery phrase does not match the Google Drive vault backup.');
      }
      this.lock();
      this.secretKey = secretKey;
      this.syntheticSecretKey = syntheticSecretKey;
      this.publicKey.set(normalizeHex(publicKey));
      this.unlocked.set(true);
      secretKey = null;
      syntheticSecretKey = null;
      return normalizeHex(publicKey);
    } finally {
      seed.fill(0);
      masterSecretKey?.free();
      secretKey?.free();
      syntheticSecretKey?.free();
    }
  }

  lock(): void {
    this.secretKey?.free();
    this.syntheticSecretKey?.free();
    this.secretKey = null;
    this.syntheticSecretKey = null;
    this.publicKey.set(null);
    this.unlocked.set(false);
  }

  signChip0002Message(messageHex: string): string {
    ensureGoogleVaultTestnet();
    const secretKey = this.requireSecretKey();
    const sdk = this.sdk();
    const clvm = new sdk.Clvm();
    let digest: Uint8Array | null = null;
    try {
      const message = hexToBytes(messageHex);
      if (message.length !== 32) {
        throw new Error('The SolSlot registration challenge must be 32 bytes.');
      }
      const signedMessage = clvm.pair(
        clvm.string('Chia Signed Message'),
        clvm.atom(message),
      );
      try {
        digest = signedMessage.treeHash();
      } finally {
        signedMessage.free();
      }
      const signature = secretKey.sign(digest);
      try {
        return bytesToHex(signature.toBytes());
      } finally {
        signature.free();
      }
    } finally {
      digest?.fill(0);
      clvm.free();
    }
  }

  signSpendBundle(coinSpends: ReadonlyArray<UnsignedCoinSpend>): SignedSpendBundle {
    if (coinSpends.length === 0) throw new Error('signSpendBundle: empty coinSpends array');
    const sdk = this.sdk();
    const signatures: WasmSignature[] = [];
    try {
      for (const spend of coinSpends) {
        signatures.push(...this.signCoinSpend(spend, sdk));
      }
      if (signatures.length === 0) {
        throw new Error('Google wallet refused a spend bundle with no owner signature conditions.');
      }
      const aggregate = sdk.Signature.aggregate(signatures);
      try {
        return {
          coinSpends: [...coinSpends],
          aggregatedSignature: bytesToHex(aggregate.toBytes()),
        };
      } finally {
        aggregate.free();
      }
    } finally {
      signatures.forEach((signature) => signature.free());
    }
  }

  private signCoinSpend(spend: UnsignedCoinSpend, sdk: GoogleBlsSdk): WasmSignature[] {
    const parent = requireLength(hexToBytes(spend.coin.parentCoinInfo), 32, 'parent coin id');
    const puzzleHash = requireLength(hexToBytes(spend.coin.puzzleHash), 32, 'puzzle hash');
    const puzzleReveal = hexToBytes(spend.puzzleReveal);
    const solution = hexToBytes(spend.solution);
    const coin = new sdk.Coin(parent, puzzleHash, BigInt(spend.coin.amount));
    const clvm = new sdk.Clvm();
    const signatures: WasmSignature[] = [];
    try {
      const puzzle = clvm.deserialize(puzzleReveal);
      const solutionProgram = clvm.deserialize(solution);
      let output: WasmOutput;
      try {
        output = puzzle.run(solutionProgram, MAX_BLOCK_COST_CLVM, false);
      } finally {
        puzzle.free();
        solutionProgram.free();
      }
      try {
        const outputValue = output.value;
        try {
          const conditions = outputValue.toList();
          if (!conditions) throw new Error('Google wallet could not parse spend conditions.');
          for (const condition of conditions) {
            try {
              const request = parseAggSigCondition(condition);
              if (!request) continue;
              try {
                const key = this.keyForPublicKey(request.publicKey);
                const finalMessage = buildAggSigMessage(
                  request.kind,
                  request.message,
                  coin,
                  parent,
                  puzzleHash,
                  sdk,
                );
                try {
                  signatures.push(key.sign(finalMessage));
                } finally {
                  finalMessage.fill(0);
                }
              } finally {
                request.publicKey.free();
              }
            } finally {
              condition.free();
            }
          }
        } finally {
          outputValue.free();
        }
      } finally {
        output.free();
      }
      return signatures;
    } catch (error) {
      signatures.forEach((signature) => signature.free());
      throw error;
    } finally {
      coin.free();
      clvm.free();
    }
  }

  private keyForPublicKey(publicKey: WasmPublicKey): WasmSecretKey {
    const requested = bytesToHex(publicKey.toBytes());
    const master = this.requireSecretKey();
    if (normalizeHex(requested) === normalizeHex(publicKeyHex(master))) {
      return master;
    }
    const synthetic = this.syntheticSecretKey;
    if (
      synthetic &&
      normalizeHex(requested) === normalizeHex(publicKeyHex(synthetic))
    ) {
      return synthetic;
    }
    throw new Error('Google wallet refused a signature request for an unknown BLS public key.');
  }

  private requireSecretKey(): WasmSecretKey {
    if (!this.secretKey || !this.unlocked()) {
      throw new Error('Google vault is locked. Sign in with Google and enter the recovery password.');
    }
    return this.secretKey;
  }

  private sdk(): GoogleBlsSdk {
    const sdk = this.wasm.sdk() as unknown as Partial<GoogleBlsSdk>;
    if (!sdk.SecretKey || !sdk.Signature || !sdk.Coin || !sdk.Clvm || !sdk.sha256) {
      throw new Error('Chia WASM does not expose the BLS signing APIs.');
    }
    return sdk as GoogleBlsSdk;
  }
}

function ensureGoogleVaultTestnet(): void {
  if (!environment.googleVaultEnabled || environment.chiaNetwork !== 'testnet11') {
    throw new Error('Google Vault is available only in the enabled Testnet11 deployment.');
  }
}

type AggSigKind =
  | 'parent'
  | 'puzzle'
  | 'amount'
  | 'puzzle_amount'
  | 'parent_amount'
  | 'parent_puzzle'
  | 'unsafe'
  | 'me';

function parseAggSigCondition(condition: WasmProgram): {
  kind: AggSigKind;
  publicKey: WasmPublicKey;
  message: Uint8Array;
} | null {
  const parsers: Array<[AggSigKind, () => WasmAggSig | undefined]> = [
    ['parent', () => condition.parseAggSigParent()],
    ['puzzle', () => condition.parseAggSigPuzzle()],
    ['amount', () => condition.parseAggSigAmount()],
    ['puzzle_amount', () => condition.parseAggSigPuzzleAmount()],
    ['parent_amount', () => condition.parseAggSigParentAmount()],
    ['parent_puzzle', () => condition.parseAggSigParentPuzzle()],
    ['unsafe', () => condition.parseAggSigUnsafe()],
    ['me', () => condition.parseAggSigMe()],
  ];
  for (const [kind, parser] of parsers) {
    const parsed = parser();
    if (!parsed) continue;
    const result = { kind, publicKey: parsed.publicKey, message: parsed.message };
    parsed.free();
    return result;
  }
  return null;
}

export function buildAggSigMessage(
  kind: AggSigKind,
  message: Uint8Array,
  coin: WasmCoin,
  parent: Uint8Array,
  puzzleHash: Uint8Array,
  sdk: GoogleBlsSdk,
): Uint8Array {
  if (kind === 'unsafe') return new Uint8Array(message);
  const base = requireLength(
    hexToBytes(environment.chiaAggSigMeAdditionalData),
    32,
    'AGG_SIG additional data',
  );
  const amount = encodeClvmInteger(coin.amount);
  let addendum: Uint8Array;
  let additionalData: Uint8Array;
  switch (kind) {
    case 'parent':
      addendum = parent;
      additionalData = sdk.sha256(concat(base, Uint8Array.of(43)));
      break;
    case 'puzzle':
      addendum = puzzleHash;
      additionalData = sdk.sha256(concat(base, Uint8Array.of(44)));
      break;
    case 'amount':
      addendum = amount;
      additionalData = sdk.sha256(concat(base, Uint8Array.of(45)));
      break;
    case 'puzzle_amount':
      addendum = concat(puzzleHash, amount);
      additionalData = sdk.sha256(concat(base, Uint8Array.of(46)));
      break;
    case 'parent_amount':
      addendum = concat(parent, amount);
      additionalData = sdk.sha256(concat(base, Uint8Array.of(47)));
      break;
    case 'parent_puzzle':
      addendum = concat(parent, puzzleHash);
      additionalData = sdk.sha256(concat(base, Uint8Array.of(48)));
      break;
    case 'me':
      addendum = coin.coinId();
      additionalData = base;
      break;
  }
  return concat(message, addendum, additionalData);
}

export function encodeClvmInteger(value: bigint): Uint8Array {
  if (value < 0n) throw new Error('Coin amount cannot be negative.');
  if (value === 0n) return new Uint8Array();
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0n) {
    bytes.unshift(Number(remaining & 0xffn));
    remaining >>= 8n;
  }
  if ((bytes[0] & 0x80) !== 0) bytes.unshift(0);
  return Uint8Array.from(bytes);
}

function concat(...values: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(values.reduce((length, value) => length + value.length, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function requireLength(value: Uint8Array, length: number, label: string): Uint8Array {
  if (value.length !== length) throw new Error(`${label} must be ${length} bytes.`);
  return value;
}

function normalizeHex(value: string): string {
  return `0x${value.toLowerCase().replace(/^0x/, '')}`;
}

function publicKeyHex(secretKey: WasmSecretKey): string {
  const publicKey = secretKey.publicKey();
  try {
    return bytesToHex(publicKey.toBytes());
  } finally {
    publicKey.free();
  }
}

interface WasmFreeable {
  free(): void;
}

interface WasmPublicKey extends WasmFreeable {
  toBytes(): Uint8Array;
}

interface WasmSignature extends WasmFreeable {
  toBytes(): Uint8Array;
}

interface WasmSecretKey extends WasmFreeable {
  publicKey(): WasmPublicKey;
  sign(message: Uint8Array): WasmSignature;
  deriveSynthetic(): WasmSecretKey;
  deriveUnhardenedPath(path: number[]): WasmSecretKey;
}

interface WasmAggSig extends WasmFreeable {
  publicKey: WasmPublicKey;
  message: Uint8Array;
}

interface WasmProgram extends WasmFreeable {
  treeHash(): Uint8Array;
  run(solution: WasmProgram, maxCost: bigint, mempoolMode: boolean): WasmOutput;
  toList(): WasmProgram[] | undefined;
  parseAggSigParent(): WasmAggSig | undefined;
  parseAggSigPuzzle(): WasmAggSig | undefined;
  parseAggSigAmount(): WasmAggSig | undefined;
  parseAggSigPuzzleAmount(): WasmAggSig | undefined;
  parseAggSigParentAmount(): WasmAggSig | undefined;
  parseAggSigParentPuzzle(): WasmAggSig | undefined;
  parseAggSigUnsafe(): WasmAggSig | undefined;
  parseAggSigMe(): WasmAggSig | undefined;
}

interface WasmOutput extends WasmFreeable {
  value: WasmProgram;
}

interface WasmCoin extends WasmFreeable {
  amount: bigint;
  coinId(): Uint8Array;
}

interface WasmClvm extends WasmFreeable {
  pair(first: WasmProgram, rest: WasmProgram): WasmProgram;
  string(value: string): WasmProgram;
  atom(value: Uint8Array): WasmProgram;
  deserialize(value: Uint8Array): WasmProgram;
}

interface GoogleBlsSdk {
  SecretKey: { fromSeed(seed: Uint8Array): WasmSecretKey };
  Signature: { aggregate(signatures: WasmSignature[]): WasmSignature };
  Coin: new (parentCoinInfo: Uint8Array, puzzleHash: Uint8Array, amount: bigint) => WasmCoin;
  Clvm: new () => WasmClvm;
  sha256(value: Uint8Array): Uint8Array;
}
