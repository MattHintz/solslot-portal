import {
  Component,
  OnInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  signal,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ZKPassport, type ProofResult, type SolidityVerifierParameters } from '@zkpassport/sdk';
import {
  getCurrentDateFromOuterProof,
  getNullifierFromOuterProof,
  getNullifierTypeFromOuterProof,
  getScopeFromOuterProof,
  getSubscopeFromOuterProof,
} from '@zkpassport/utils';
import QRCode from 'qrcode';
import { ethers } from 'ethers';

import { environment } from '../../../environments/environment';
import { ZkPassportAttestationService } from '../../services/zkpassport-attestation.service';

export type VerifyStatus =
  | 'loading'
  | 'ready'
  | 'scanned'
  | 'generating'
  | 'submitting'
  | 'success'
  | 'rejected'
  | 'error';

interface BridgeDiagnostics {
  onRawMessage?: (cb: (data: unknown) => void) => void;
  onSecureMessage?: (cb: (msg: unknown) => void) => void;
  onError?: (cb: (err: unknown) => void) => void;
  onDisconnect?: (cb: (evt: unknown) => void) => void;
  onConnect?: (cb: (reconnected: boolean) => void) => void;
}

const POLICY_ID = 'compliance-check-kyc';

const EMITTER_ABI = [
  'function verifyAndEmit((bytes32 vaultLauncherId, bytes32 scopedNullifier, uint16 nullifierType, bytes32 serviceScopeHash, bytes32 serviceSubscopeHash, uint64 proofTimestamp, bytes32 attestationLeafHash, bytes32 attestationRoot, bytes32 bridgeParentId, uint64 bridgeAmount, bytes32 bridgeCoinId, bytes32 bridgeMessage) attestation, bytes proof) external',
];

@Component({
  selector: 'app-verify',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="verify-page">
      <div class="verify-card">
        <div class="verify-logo">
          <span class="verify-brand">Populis</span>
          <span class="verify-powered">Verified by zkPassport</span>
        </div>

        <ng-container [ngSwitch]="status()">

          <ng-container *ngSwitchCase="'loading'">
            <div class="verify-spinner"></div>
            <p class="verify-hint">Preparing verification request…</p>
          </ng-container>

          <ng-container *ngSwitchCase="'ready'">
            <p class="verify-instructions">
              Scan with the <strong>zkPassport app</strong> to verify your identity
            </p>
            <canvas #qrCanvas class="verify-qr"></canvas>
            <p class="verify-hint">Or open on your phone:</p>
            <a class="verify-link" [href]="proofUrl()" target="_blank" rel="noopener">
              Open in zkPassport app
            </a>
          </ng-container>

          <ng-container *ngSwitchCase="'scanned'">
            <div class="verify-spinner"></div>
            <p class="verify-hint">QR code scanned — waiting for proof…</p>
          </ng-container>

          <ng-container *ngSwitchCase="'generating'">
            <div class="verify-spinner"></div>
            <p class="verify-hint">Generating proof — this may take a moment…</p>
          </ng-container>

          <ng-container *ngSwitchCase="'submitting'">
            <div class="verify-spinner"></div>
            <p class="verify-hint">Submitting proof on-chain…</p>
            <p class="verify-hint" style="font-size:12px">Approve the signature in your wallet — no gas needed.</p>
          </ng-container>

          <ng-container *ngSwitchCase="'success'">
            <div class="verify-success-icon">✓</div>
            <p class="verify-hint">Identity verified! You can close this window.</p>
          </ng-container>

          <ng-container *ngSwitchCase="'rejected'">
            <div class="verify-error-icon">✗</div>
            <p class="verify-hint">Verification was cancelled.</p>
            <button class="verify-btn" (click)="restart()">Try again</button>
          </ng-container>

          <ng-container *ngSwitchCase="'error'">
            <div class="verify-error-icon">!</div>
            <p class="verify-hint">{{ errorMessage() }}</p>
            <button class="verify-btn" (click)="restart()">Try again</button>
          </ng-container>

        </ng-container>
      </div>
    </div>
  `,
  styles: [`
    .verify-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f172a;
      font-family: system-ui, sans-serif;
    }
    .verify-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 40px 32px;
      width: 100%;
      max-width: 400px;
      text-align: center;
      color: #f1f5f9;
    }
    .verify-logo {
      margin-bottom: 24px;
    }
    .verify-brand {
      display: block;
      font-size: 24px;
      font-weight: 700;
      color: #38bdf8;
    }
    .verify-powered {
      font-size: 12px;
      color: #94a3b8;
    }
    .verify-instructions {
      color: #cbd5e1;
      margin-bottom: 20px;
      line-height: 1.5;
    }
    .verify-qr {
      display: block;
      margin: 0 auto 16px;
      border-radius: 8px;
    }
    .verify-hint {
      color: #94a3b8;
      font-size: 14px;
      margin: 12px 0;
    }
    .verify-link {
      display: inline-block;
      color: #38bdf8;
      font-size: 14px;
      word-break: break-all;
      margin-top: 8px;
    }
    .verify-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #334155;
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 16px auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .verify-success-icon {
      font-size: 48px;
      color: #4ade80;
      margin: 16px 0;
    }
    .verify-error-icon {
      font-size: 48px;
      color: #f87171;
      margin: 16px 0;
    }
    .verify-btn {
      margin-top: 16px;
      padding: 10px 24px;
      background: #38bdf8;
      color: #0f172a;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
    }
  `],
})
export class VerifyComponent implements OnInit, OnDestroy {
  @ViewChild('qrCanvas') qrCanvas?: ElementRef<HTMLCanvasElement>;

  status = signal<VerifyStatus>('loading');
  proofUrl = signal<string>('');
  errorMessage = signal<string>('');

  private route = inject(ActivatedRoute);
  private attestation = inject(ZkPassportAttestationService);
  private zkp: ZKPassport | null = null;
  private cleanup: (() => void) | null = null;

  async ngOnInit(): Promise<void> {
    await this.startVerification();
  }

  ngOnDestroy(): void {
    this.cleanup?.();
  }

  async restart(): Promise<void> {
    this.cleanup?.();
    this.status.set('loading');
    this.proofUrl.set('');
    this.errorMessage.set('');
    await this.startVerification();
  }

  private async startVerification(): Promise<void> {
    try {
      const params = this.route.snapshot.queryParamMap;
      const customData = params.get('custom_data') ?? undefined;

      // Use the actual serving origin as the zkPassport domain, exactly like the
      // official example (app/page.tsx: `new ZKPassport(window.location.hostname)`).
      // Locally this resolves to 127.0.0.1 -> no registered project -> SELF-SERVE mode
      // (no origin allowlist enforcement), so dev-mode mock proofs are delivered back.
      // In production it resolves to populis.app automatically (DNS-verify it there).
      // Hardcoding 'populis.app' here made the phone enforce that registered+unverified
      // project's origin allowlist and silently refuse to deliver proofs to localhost.
      const zkDomain = window.location.hostname;
      const zkp = new ZKPassport(zkDomain);
      console.log('[zkpassport] SDK domain =', zkDomain);
      this.zkp = zkp;

      // The on-chain adapter (ZkPassportRealVerifierAdapter) forces the proof's
      // service subscope to equal PopulisZkPassportAttestationEmitter.expectedVaultSubscope():
      //   "vault:0x<vaultLauncherId>"  — exactly the custom_data query param, lowercase.
      // zkPassport derives the proof's subscope from the request `scope`, so `scope`
      // MUST be that vault subscope or the root verifier reverts "Invalid domain or scope".
      const vaultSubscope =
        customData?.toLowerCase().startsWith('vault:0x') ? customData.toLowerCase() : undefined;

      const queryBuilder = await zkp.request({
        name: 'Populis',
        purpose: 'Age verification',
        devMode: environment.zkPassport.devMode ?? false,
        scope: vaultSubscope ?? 'populis-verify',
        mode: 'compressed-evm',
      });

      const result = queryBuilder
        .gte('age', 18)
        .done();

      this.proofUrl.set(result.url);
      this.status.set('ready');

      await this.renderQr(result.url);

      // --- Bridge-level diagnostics ---
      // The SDK wires only onConnect/onSecureChannelEstablished/onSecureMessage and
      // silently ignores the bridge's error/disconnect/raw-message events. Tap the
      // internal connection so we can see why a generated proof never reaches us.
      try {
        const requestId = (result as { requestId?: string }).requestId;
        const bridgeMap = (zkp as unknown as {
          topicToBridge?: Record<string, BridgeDiagnostics | undefined>;
        }).topicToBridge;
        const bridge = requestId ? bridgeMap?.[requestId] : undefined;
        if (bridge) {
          let rawCount = 0;
          bridge.onRawMessage?.((data: unknown) => {
            rawCount += 1;
            const str = typeof data === 'string' ? data : JSON.stringify(data);
            const len = str ? str.length : -1;
            const preview = str ? str.slice(0, 400) : '(non-string)';
            console.log(`[bridge] raw #${rawCount} (len=${len}):`, preview);
          });
          bridge.onSecureMessage?.((msg: unknown) => {
            const m = msg as { method?: string; params?: unknown };
            console.log(
              '[bridge] DECRYPTED message-received — method=',
              m?.method,
              'paramsType=',
              typeof m?.params,
            );
          });
          bridge.onError?.((err: unknown) => {
            console.error('[bridge] ERROR (swallowed by SDK):', err);
          });
          bridge.onDisconnect?.((evt: unknown) => {
            console.warn('[bridge] DISCONNECTED:', evt);
          });
          bridge.onConnect?.((reconnected: boolean) => {
            console.log(`[bridge] connected (reconnected=${reconnected})`);
          });
          console.log('[bridge] diagnostics attached for', requestId);
        } else {
          console.warn('[bridge] could not access bridge connection for diagnostics');
        }
      } catch (diagErr) {
        console.warn('[bridge] diagnostics attach failed:', diagErr);
      }

      result.onRequestReceived(() => {
        console.log('[zkpassport] QR scanned / request received');
        this.status.set('scanned');
      });

      result.onGeneratingProof(() => {
        console.log('[zkpassport] generating proof');
        this.status.set('generating');
      });

      let capturedProof: ProofResult | null = null;
      let submitted = false;
      result.onProofGenerated((proof: ProofResult) => {
        console.log('[zkpassport] proof generated', proof);
        capturedProof = proof;
        // Fallback: if onResult never fires (WebSocket drop after proof), submit after 5s
        setTimeout(async () => {
          const fallbackProof = capturedProof;
          if (submitted || !fallbackProof) return;
          submitted = true;
          console.warn('[zkpassport] onResult timeout — proceeding with captured proof');
          try {
            this.status.set('submitting');
            await this.submitOnChain(fallbackProof, customData, zkp);
            this.status.set('success');
            if (window.opener) {
              window.opener.postMessage(
                { type: 'zkpassport_proof', verified: true },
                window.location.origin,
              );
            }
            setTimeout(() => window.close(), 2000);
          } catch (err) {
            console.error('[zkpassport] fallback submitOnChain error:', err);
            this.status.set('error');
            this.errorMessage.set(err instanceof Error ? err.message : 'On-chain submission failed.');
          }
        }, 5000);
      });

      result.onResult(async ({ verified, result: queryResult, proofs }) => {
        console.log('[zkpassport] onResult — verified:', verified, 'proofs count:', proofs?.length, 'capturedProof:', !!capturedProof);

        const proofResult = capturedProof ?? proofs?.[0];
        if (!proofResult) {
          console.error('[zkpassport] onResult: no proof available, verified=', verified);
          this.status.set('error');
          this.errorMessage.set('No proof data received.');
          return;
        }

        if (submitted) {
          console.log('[zkpassport] onResult: already submitted via fallback — skipping duplicate');
          return;
        }
        submitted = true;

        if (!verified) {
          console.warn('[zkpassport] SDK internal verify returned false — attempting on-chain submission anyway (contract verifies independently)');
        }

        try {
          this.status.set('submitting');
          await this.submitOnChain(proofResult, customData, zkp);
          this.status.set('success');
          if (window.opener) {
            window.opener.postMessage(
              { type: 'zkpassport_proof', verified: true, result: queryResult },
              window.location.origin,
            );
          }
          setTimeout(() => window.close(), 2000);
        } catch (err) {
          console.error('[zkpassport] submitOnChain error:', err);
          if (isUserRejection(err)) {
            this.status.set('rejected');
          } else {
            this.status.set('error');
            this.errorMessage.set(
              err instanceof Error ? err.message : 'On-chain submission failed.',
            );
          }
        }
      });

      result.onReject(() => {
        console.log('[zkpassport] rejected');
        this.status.set('rejected');
      });

      result.onError((err: unknown) => {
        console.error('[zkpassport] onError:', err);
        this.status.set('error');
        this.errorMessage.set(
          err instanceof Error ? err.message : String(err),
        );
      });

      this.cleanup = () => {
        /* SDK handles its own WebSocket cleanup */
      };
    } catch (err) {
      this.status.set('error');
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to start verification.',
      );
    }
  }

  private async submitOnChain(
    proof: ProofResult,
    customData: string | undefined,
    zkp: ZKPassport,
  ): Promise<void> {
    const { ethereum } = window as unknown as { ethereum?: ethers.Eip1193Provider };
    if (!ethereum) {
      throw new Error('MetaMask not found. Please install MetaMask to submit the proof on-chain.');
    }

    await ethereum.request({ method: 'eth_requestAccounts' });
    const provider = new ethers.BrowserProvider(ethereum);

    const network = await provider.getNetwork();
    const ethSepolia = 11155111n;
    if (network.chainId !== ethSepolia) {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xaa36a7' }],
      });
    }

    const signer = await provider.getSigner();

    // Let SDK extract domain/scope/devMode from the proof itself; don't override.
    // The proof contains the exact serviceConfig values used during generation.
    const solidityParams: SolidityVerifierParameters = zkp.getSolidityVerifierParameters({
      proof,
    });

    // Extract attestation fields with the SDK's canonical outer-proof getters instead
    // of hand-indexing publicInputs. Outer circuit public-input layout is:
    //   [0] certRoot [1] circuitRoot [2] date [3] serviceScope [4] serviceSubscope
    //   [5..len-4] paramCommitments [len-3] nullifierType [len-2] scopedNullifier [len-1] oprfPkHash
    // The old manual math read [len-2] (the scoped-nullifier hash) as the type, which is
    // why submitOnChain threw "nullifierType ... got 7.44e+75". The getters own the indices.
    const outerProof = {
      publicInputs: solidityParams.proofVerificationData.publicInputs,
      proof: [] as string[],
    };
    const proofTimestamp = Math.floor(getCurrentDateFromOuterProof(outerProof).getTime() / 1000);
    const serviceScopeHash = ethers.toBeHex(getScopeFromOuterProof(outerProof), 32) as `0x${string}`;
    const serviceSubscopeHash = ethers.toBeHex(getSubscopeFromOuterProof(outerProof), 32) as `0x${string}`;
    const nullifierType = Number(getNullifierTypeFromOuterProof(outerProof));
    const scopedNullifier = ethers.toBeHex(getNullifierFromOuterProof(outerProof), 32) as `0x${string}`;

    // vaultLauncherId from custom_data = "vault:0x<hex>"
    if (!customData?.startsWith('vault:0x')) {
      throw new Error(`Invalid custom_data for vault subscope: ${customData}`);
    }
    const vaultLauncherId = `0x${customData.slice(8)}` as `0x${string}`;

    // Compute attestation leaf + root
    const attestationLeafHash = this.attestation.computeAttestationLeaf({
      vaultLauncherId,
      scopedNullifier,
      nullifierType,
      serviceScopeHash,
      serviceSubscopeHash,
      proofTimestamp,
    });
    const attestationRoot = this.attestation.computeAttestationRoot([attestationLeafHash]);

    // Bridge fields from environment
    const bridgeParentId = environment.zkPassport.bridgeParentId as `0x${string}`;
    const bridgeAmount = BigInt(environment.zkPassport.bridgeAmount);
    const bridgePolicyHash = '0xc87f45cd23d052c88256de8823a4a01f40da4e2066156f48f3b3dfc0a50350d7';

    // bridgeCoinId = sha256(parentId ++ puzzleHash ++ clvmUint64(amount))
    const bridgeCoinId = ethers.sha256(ethers.concat([
      ethers.getBytes(bridgeParentId),
      ethers.getBytes(bridgePolicyHash),
      clvmUint64Bytes(bridgeAmount),
    ]));

    // bridgeMessage = attestation bridge message hash
    const bridgeMessage = this.attestation.computeAttestationBridgeMessage({
      vaultLauncherId,
      attestationRoot,
      bridgePolicyHash,
    });

    const attestationStruct = {
      vaultLauncherId,
      scopedNullifier,
      nullifierType,
      serviceScopeHash,
      serviceSubscopeHash,
      proofTimestamp,
      attestationLeafHash,
      attestationRoot,
      bridgeParentId,
      bridgeAmount,
      bridgeCoinId,
      bridgeMessage,
    };

    // Encode the SolidityVerifierParameters as bytes for the proof arg
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encodedProof = abiCoder.encode(
      ['tuple(bytes32 version, tuple(bytes32 vkeyHash, bytes proof, bytes32[] publicInputs) proofVerificationData, bytes committedInputs, tuple(uint256 validityPeriodInSeconds, string domain, string scope, bool devMode) serviceConfig)'],
      // serviceConfig: 4 fields matching SDK output (validityPeriodInSeconds, domain, scope, devMode)
      [[
        solidityParams.version,
        [
          solidityParams.proofVerificationData.vkeyHash,
          solidityParams.proofVerificationData.proof,
          solidityParams.proofVerificationData.publicInputs,
        ],
        solidityParams.committedInputs,
        [
          solidityParams.serviceConfig.validityPeriodInSeconds,
          solidityParams.serviceConfig.domain,
          solidityParams.serviceConfig.scope,
          solidityParams.serviceConfig.devMode,
        ],
      ]],
    );

    // ── Gasless submission via ERC-2771 meta-transaction ────────────────
    // The user signs an EIP-712 ForwardRequest (no gas); the operator relayer
    // submits forwarder.execute() and pays the gas. The emitter attributes the
    // event to the user's address via _msgSender(), so the relayer is never the
    // logical author.
    const emitterAddress = environment.zkPassport.attestationEmitterAddress;
    const forwarderAddress = environment.zkPassport.trustedForwarderAddress;
    if (!forwarderAddress) {
      throw new Error('Gasless relayer is not configured (trustedForwarderAddress missing).');
    }

    const data = new ethers.Interface(EMITTER_ABI).encodeFunctionData('verifyAndEmit', [
      attestationStruct,
      encodedProof,
    ]);
    const from = await signer.getAddress();

    // Gas the forwarded verifyAndEmit call needs (+20% for ERC2771 _checkForwardedGas).
    let innerGas: bigint;
    try {
      innerGas = await provider.estimateGas({ from, to: emitterAddress, data });
    } catch {
      innerGas = 1_500_000n; // verifyAndEmit measures ~1.05M; generous fallback
    }
    const gas = (innerGas * 12n) / 10n;

    const forwarder = new ethers.Contract(
      forwarderAddress,
      ['function nonces(address) view returns (uint256)'],
      provider,
    );
    const nonce: bigint = await forwarder['nonces'](from);
    const deadline = Math.floor(Date.now() / 1000) + 1800; // 30 minutes

    // EIP-712 domain + types MUST match OpenZeppelin ERC2771Forwarder exactly.
    const domain = {
      name: 'PopulisForwarder',
      version: '1',
      chainId: ethSepolia,
      verifyingContract: forwarderAddress,
    };
    const types = {
      ForwardRequest: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'gas', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint48' },
        { name: 'data', type: 'bytes' },
      ],
    };
    const message = { from, to: emitterAddress, value: 0n, gas, nonce, deadline, data };

    // Gasless: MetaMask shows a typed-data signature request, not a transaction.
    const signature = await signer.signTypedData(domain, types, message);

    const resp = await fetch(`${environment.faucetApi}/zkpassport/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: emitterAddress,
        value: '0',
        gas: gas.toString(),
        deadline,
        data,
        signature,
      }),
    });
    if (!resp.ok) {
      let detail = `${resp.status}`;
      try {
        const body = await resp.json();
        detail = body?.detail ? `${resp.status}: ${body.detail}` : detail;
      } catch {
        /* non-JSON error body */
      }
      throw new Error(`Relayer could not submit the proof (${detail}).`);
    }
    const relayResult = (await resp.json()) as { tx_hash?: string };
    console.log('[zkpassport] relayed tx:', relayResult?.tx_hash);
  }

  private async renderQr(url: string): Promise<void> {
    for (let i = 0; i < 10; i++) {
      if (this.qrCanvas?.nativeElement) {
        await QRCode.toCanvas(this.qrCanvas.nativeElement, url, {
          width: 280,
          margin: 1,
          color: { dark: '#0f172a', light: '#f1f5f9' },
        });
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }
}

/** True when a wallet error represents the user rejecting the signature. */
function isUserRejection(err: unknown): boolean {
  const e = err as { code?: unknown; info?: { error?: { code?: unknown } } } | null;
  return (
    !!e &&
    (e.code === 'ACTION_REJECTED' || e.code === 4001 || e.info?.error?.code === 4001)
  );
}

/** Mirrors Solidity _clvmUint64: minimal big-endian bytes with leading 0x00 if high bit set. */
function clvmUint64Bytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array(0);
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0n) {
    bytes.unshift(Number(remaining & 0xffn));
    remaining >>= 8n;
  }
  if (bytes[0] & 0x80) bytes.unshift(0);
  return new Uint8Array(bytes);
}
