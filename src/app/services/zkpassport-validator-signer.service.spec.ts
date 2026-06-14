import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { ZkPassportValidatorSignerService } from './zkpassport-validator-signer.service';
import { environment } from '../../environments/environment';

const BASE = environment.faucetApi;

describe('ZkPassportValidatorSignerService', () => {
  let service: ZkPassportValidatorSignerService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(ZkPassportValidatorSignerService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getValidatorInfo calls GET /zkpassport/validator', async () => {
    const promise = service.getValidatorInfo();
    const req = httpMock.expectOne(`${BASE}/zkpassport/validator`);
    expect(req.request.method).toBe('GET');
    req.flush({ pubkey_hex: 'aa'.repeat(48), threshold: 1 });
    const info = await promise;
    expect(info.pubkey_hex).toBe('aa'.repeat(48));
    expect(info.threshold).toBe(1);
  });

  it('signValidatorMessage POSTs to /zkpassport/sign and returns ValidatorBridgeSignature', async () => {
    const msgHex = '0x' + 'ab'.repeat(32);
    const promise = service.signValidatorMessage(msgHex);
    const req = httpMock.expectOne(`${BASE}/zkpassport/sign`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ validator_message_hex: msgHex });
    req.flush({
      pubkey_hex: 'cc'.repeat(48),
      signature_hex: 'dd'.repeat(96),
      validator_message_hex: msgHex,
    });
    const sig = await promise;
    expect(sig.validatorPubkey).toBe('0x' + 'cc'.repeat(48));
    expect(sig.signature).toBe('0x' + 'dd'.repeat(96));
  });

  it('collectSignatures returns an array with one signature', async () => {
    const msgHex = '0x' + 'ab'.repeat(32);
    const promise = service.collectSignatures(msgHex);
    const req = httpMock.expectOne(`${BASE}/zkpassport/sign`);
    req.flush({
      pubkey_hex: 'cc'.repeat(48),
      signature_hex: 'dd'.repeat(96),
      validator_message_hex: msgHex,
    });
    const sigs = await promise;
    expect(sigs.length).toBe(1);
    expect(sigs[0].signature).toBe('0x' + 'dd'.repeat(96));
  });
});
