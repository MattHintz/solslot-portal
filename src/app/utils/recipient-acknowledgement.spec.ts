import fixture from './recipient-acknowledgement.fixture.json';
import { environment } from '../../environments/environment';
import { EvmWalletService } from '../services/evm-wallet.service';
import { Eip712TypedData } from '../services/solslot-api.service';
import { RecipientConsentReview } from '../services/generation-recipients.service';

describe('Generation recipient wallet consent',()=>{
  const runtime=environment.solslotProtocol as {generationId?:string};
  let previous:string|undefined;
  beforeEach(()=>{previous=runtime.generationId;runtime.generationId=fixture.review.generationId;});
  afterEach(()=>{if(previous===undefined)delete runtime.generationId;else runtime.generationId=previous;});
  function service(){
    const wallet=Object.create(EvmWalletService.prototype);
    Object.assign(wallet,{eip1193:{},address:()=>fixture.review.recipient.wallet});
    const sign=spyOn<any>(wallet,'signTypedDataOnChain').and.resolveTo('test-signature');
    return {wallet,sign};
  }
  it('signs the exact API fixture after reconstructing its destination and schema',async()=>{
    const {wallet,sign}=service();
    expect(await wallet.signRecipientAcknowledgement(fixture.typedData,fixture.review)).toBe('test-signature');
    expect(sign).toHaveBeenCalledOnceWith(fixture.typedData,environment.eip712ChainId);
  });
  for(const field of ['generation','amount','recipient','identity','network','schema','manifest','extra'])
    it('rejects altered '+field+' before opening any wallet prompt',async()=>{
      const {wallet,sign}=service(),data=structuredClone(fixture.typedData) as Eip712TypedData;
      if(field==='generation')data.domain.salt='0x'+'12'.repeat(32);
      if(field==='amount')data.message['amount']=20000;
      if(field==='recipient')data.message['recipientVault']='0x'+'23'.repeat(32);
      if(field==='identity')data.message['identityAuthority']='0x'+'34'.repeat(32);
      if(field==='network')data.message['network']='mainnet';
      if(field==='schema')data.types['SolslotSGTRecipient'][0].type='string';
      if(field==='manifest')data.message['preparationManifest']='0x'+'45'.repeat(32);
      if(field==='extra')data.message['transferAll']=true;
      await expectAsync(wallet.signRecipientAcknowledgement(data,fixture.review)).toBeRejected();
      expect(sign).not.toHaveBeenCalled();
    });
  it('rejects another wallet and another deployment build',async()=>{
    const {wallet,sign}=service();
    wallet.address=()=> '0x'+'23'.repeat(20);
    await expectAsync(wallet.signRecipientAcknowledgement(fixture.typedData,fixture.review)).toBeRejected();
    wallet.address=()=>fixture.review.recipient.wallet;runtime.generationId='0x'+'98'.repeat(32);
    await expectAsync(wallet.signRecipientAcknowledgement(fixture.typedData,fixture.review)).toBeRejected();
    expect(sign).not.toHaveBeenCalled();
  });
  it('does not accept a signature after the connected wallet changed',async()=>{
    const {wallet,sign}=service();
    sign.and.callFake(async()=>{wallet.eip1193={};return 'test-signature';});
    await expectAsync(wallet.signRecipientAcknowledgement(fixture.typedData,fixture.review)).toBeRejectedWithError(/wallet changed/);
  });
});
