import { Injectable, inject } from '@angular/core';

import {
  AdminAuthorityV2Service,
  LaunchOutputs,
  bytesToHexPrefixed,
} from '../admin-authority-v2/admin-authority-v2.service';
import { SignedSpendBundle } from '../chia-wallet.service';
import { PushTxResponse } from '../coinset.service';
import { ChiaWasmService } from '../chia-wasm.service';
import { hexToBytes } from '../../utils/chia-hash';
import { PROTOCOL_CONFIG_INNER_PUZZLE_HEX } from './protocol-config.puzzle-hex';

export type ProtocolConfigNetwork = 'testnet11' | 'mainnet';

export interface ProtocolConfigLaunchInputs {
  poolLauncherId: string;
  governanceLauncherId: string;
  network: ProtocolConfigNetwork;
  configVersion: number | bigint;
  governancePubkey: string;
}

export interface ProtocolConfigLaunchPreview {
  protocolConfigModHash: string;
  contentHash: string;
  eveInnerPuzzleHash: string;
  inputs: {
    poolLauncherId: string;
    governanceLauncherId: string;
    network: ProtocolConfigNetwork;
    networkId: string;
    configVersion: number;
    governancePubkey: string;
  };
}

export interface ProtocolConfigLaunchResult {
  preview: ProtocolConfigLaunchPreview;
  launcherId: string;
  launchOutputs: LaunchOutputs;
  pushResponse: PushTxResponse;
  fullSpendBundle: SignedSpendBundle;
}

@Injectable({ providedIn: 'root' })
export class ProtocolConfigLaunchService {
  private readonly wasm = inject(ChiaWasmService);
  private readonly singletonLaunch = inject(AdminAuthorityV2Service);

  static readonly NETWORK_ID_MAINNET =
    '0xccd5bb71183532bff220ba46c268991a00000000000000000000000000000000';
  static readonly NETWORK_ID_TESTNET11 =
    '0x37a90eb5185a9c4439a91ddc98bbadce7b4feba060d50116a067de66bf236615';

  preview(args: ProtocolConfigLaunchInputs): ProtocolConfigLaunchPreview {
    const poolLauncherId = normalizeHex32(args.poolLauncherId, 'pool launcher id');
    const governanceLauncherId = normalizeHex32(
      args.governanceLauncherId,
      'governance launcher id',
    );
    const governancePubkey = normalizeHexBytes(args.governancePubkey, 48, 'governance public key');
    const networkId = this.networkId(args.network);
    const configVersion = normalizeVersion(args.configVersion);
    const clvm = this.clvm();
    const mod = clvm.deserialize(hexToBytes(PROTOCOL_CONFIG_INNER_PUZZLE_HEX));
    const protocolConfigModHash = bytesToHexPrefixed(mod.treeHash());
    const contentHash = bytesToHexPrefixed(
      clvm.list([
        clvm.atom(hexToBytes(poolLauncherId)),
        clvm.atom(hexToBytes(governanceLauncherId)),
        clvm.atom(hexToBytes(networkId)),
        clvm.int(BigInt(configVersion)),
      ]).treeHash(),
    );
    const innerPuzzle = mod.curry([
      clvm.atom(hexToBytes(protocolConfigModHash)),
      clvm.atom(hexToBytes(governancePubkey)),
      clvm.atom(hexToBytes(poolLauncherId)),
      clvm.atom(hexToBytes(governanceLauncherId)),
      clvm.atom(hexToBytes(networkId)),
      clvm.int(BigInt(configVersion)),
    ]);

    return {
      protocolConfigModHash,
      contentHash,
      eveInnerPuzzleHash: bytesToHexPrefixed(innerPuzzle.treeHash()),
      inputs: {
        poolLauncherId,
        governanceLauncherId,
        network: args.network,
        networkId,
        configVersion,
        governancePubkey,
      },
    };
  }

  async submit(args: ProtocolConfigLaunchInputs): Promise<ProtocolConfigLaunchResult> {
    const preview = this.preview(args);
    const result = await this.singletonLaunch.submitLaunch({
      eveInnerPuzzleHash: preview.eveInnerPuzzleHash,
      eveAmount: AdminAuthorityV2Service.DEFAULT_EVE_AMOUNT,
    });
    return {
      preview,
      launcherId: result.launcherId,
      launchOutputs: result.launchOutputs,
      pushResponse: result.pushResponse,
      fullSpendBundle: result.fullSpendBundle,
    };
  }

  private networkId(network: ProtocolConfigNetwork): string {
    if (network === 'mainnet') return ProtocolConfigLaunchService.NETWORK_ID_MAINNET;
    if (network === 'testnet11') return ProtocolConfigLaunchService.NETWORK_ID_TESTNET11;
    throw new Error(`unsupported network ${network}`);
  }

  private clvm(): ClvmShape {
    const sdk = this.wasm.sdk() as SdkShape;
    if (!sdk.Clvm) {
      throw new Error('chia-wallet-sdk-wasm is missing Clvm. Reload the page and try again.');
    }
    return new sdk.Clvm();
  }
}

interface ClvmShape {
  deserialize(bytes: Uint8Array): ProgramShape;
  atom(value: Uint8Array): ProgramShape;
  int(value: bigint): ProgramShape;
  list(values: ProgramShape[]): ProgramShape;
}

interface ProgramShape {
  treeHash(): Uint8Array;
  curry(args: ProgramShape[]): ProgramShape;
}

interface SdkShape {
  Clvm?: new () => ClvmShape;
}

function normalizeVersion(value: number | bigint): number {
  const n = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error('config version must be a positive safe integer');
  }
  return n;
}

function normalizeHex32(value: string, label: string): string {
  return normalizeHexBytes(value, 32, label);
}

function normalizeHexBytes(value: string, byteLength: number, label: string): string {
  const raw = value.trim();
  const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error(`${label} must be hex`);
  if (hex.length !== byteLength * 2) {
    throw new Error(`${label} must be ${byteLength} bytes`);
  }
  if (/^0+$/.test(hex)) throw new Error(`${label} cannot be zero`);
  return '0x' + hex.toLowerCase();
}
