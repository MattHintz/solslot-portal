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
import { ZKPassport } from '@zkpassport/sdk';
import QRCode from 'qrcode';

import { environment } from '../../../environments/environment';

export type VerifyStatus =
  | 'loading'
  | 'ready'
  | 'scanned'
  | 'generating'
  | 'success'
  | 'rejected'
  | 'error';

const POLICY_ID = 'compliance-check-kyc';

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

      const zkp = new ZKPassport('populis.app');
      this.zkp = zkp;

      const queryBuilder = await zkp.request({
        devMode: environment.zkPassport.devMode ?? false,
        scope: 'populis.app',
      });

      const builder = queryBuilder.policy(POLICY_ID);
      const result = (customData ? builder.bind('custom_data', customData) : builder).done();

      this.proofUrl.set(result.url);
      this.status.set('ready');

      await this.renderQr(result.url);

      result.onRequestReceived(() => {
        this.status.set('scanned');
      });

      result.onGeneratingProof(() => {
        this.status.set('generating');
      });

      result.onResult(({ verified, result: queryResult, proofs }) => {
        if (verified) {
          this.status.set('success');
          if (window.opener) {
            window.opener.postMessage(
              {
                type: 'zkpassport_proof',
                verified: true,
                result: queryResult,
                proofs,
              },
              window.location.origin,
            );
          }
          setTimeout(() => window.close(), 1500);
        } else {
          this.status.set('error');
          this.errorMessage.set('Proof verification failed.');
        }
      });

      result.onReject(() => {
        this.status.set('rejected');
      });

      result.onError((err: unknown) => {
        this.status.set('error');
        this.errorMessage.set(
          err instanceof Error ? err.message : 'An error occurred.',
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
