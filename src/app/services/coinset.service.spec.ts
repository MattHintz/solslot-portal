/**
 * Tests for ``CoinsetService.pushTransaction`` (Phase 9-Hermes-D D-2.5).
 *
 * Validates the wire format we send to coinset.org's ``/push_tx`` endpoint:
 *   * Field naming: snake_case with stripped 0x prefixes.
 *   * Response shape: success:true returns normalised status,
 *     success:false throws with the node's error message.
 *
 * Uses HttpTestingController so we can assert the exact body
 * coinset.org would receive without making real network calls.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { CoinsetService, PushTxSpendBundle } from './coinset.service';
import { environment } from '../../environments/environment';

const SAMPLE_BUNDLE: PushTxSpendBundle = {
  coinSpends: [
    {
      coin: {
        parentCoinInfo: '0x' + 'aa'.repeat(32),
        puzzleHash: '0x' + 'bb'.repeat(32),
        amount: 1n,
      },
      puzzleReveal: '0xff01ff80',
      solution: '0xff8080',
    },
  ],
  aggregatedSignature: '0x' + 'cc'.repeat(96),
};

describe('CoinsetService.pushTransaction', () => {
  let service: CoinsetService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CoinsetService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('sends snake_case + stripped-prefix wire format', async () => {
    const promise = service.pushTransaction(SAMPLE_BUNDLE);

    const req = http.expectOne(`${environment.coinsetRpc}/push_tx`);
    expect(req.request.method).toBe('POST');

    const body = req.request.body as {
      spend_bundle: {
        coin_spends: Array<{
          coin: {
            parent_coin_info: string;
            puzzle_hash: string;
            amount: number;
          };
          puzzle_reveal: string;
          solution: string;
        }>;
        aggregated_signature: string;
      };
    };

    // Top-level wrapping under spend_bundle.
    expect(body.spend_bundle).toBeDefined();

    const cs = body.spend_bundle.coin_spends[0];
    expect(cs.coin.parent_coin_info).toBe('aa'.repeat(32));
    expect(cs.coin.parent_coin_info.startsWith('0x'))
      .withContext('hex prefix should be stripped before submission')
      .toBe(false);
    expect(cs.coin.puzzle_hash).toBe('bb'.repeat(32));
    expect(cs.coin.amount).toBe(1);
    expect(cs.puzzle_reveal).toBe('ff01ff80');
    expect(cs.solution).toBe('ff8080');

    expect(body.spend_bundle.aggregated_signature).toBe('cc'.repeat(96));
    expect(body.spend_bundle.aggregated_signature.startsWith('0x')).toBe(false);

    req.flush({ success: true, status: 'SUCCESS' });
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.status).toBe('SUCCESS');
  });

  it('returns null status when node omits the field', async () => {
    const promise = service.pushTransaction(SAMPLE_BUNDLE);
    const req = http.expectOne(`${environment.coinsetRpc}/push_tx`);
    req.flush({ success: true });
    const result = await promise;
    expect(result.status).toBe(null);
  });

  it('throws with the node-provided error on success:false', async () => {
    const promise = service.pushTransaction(SAMPLE_BUNDLE);
    const req = http.expectOne(`${environment.coinsetRpc}/push_tx`);
    req.flush({ success: false, error: 'DOUBLE_SPEND_DETECTED' });
    await expectAsync(promise).toBeRejectedWithError(/DOUBLE_SPEND_DETECTED/);
  });

  it('throws "unknown" when success:false without error field', async () => {
    const promise = service.pushTransaction(SAMPLE_BUNDLE);
    const req = http.expectOne(`${environment.coinsetRpc}/push_tx`);
    req.flush({ success: false });
    await expectAsync(promise).toBeRejectedWithError(/unknown/);
  });
});
