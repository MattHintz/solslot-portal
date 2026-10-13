import {TestBed} from '@angular/core/testing';
import {Wallet} from 'ethers';
import {environment} from '../../environments/environment';
import {ChiaWalletService} from './chia-wallet.service';
import {EvmWalletService} from './evm-wallet.service';
import {ChiaWasmService} from './chia-wasm.service';
import {GoogleBlsWalletService} from './google-bls-wallet.service';
import {GenerationSgtContext,GenerationSgtRequest,inspectGenerationSgt} from '../utils/generation-sgt-review';
import {initializeVerifiedChiaRuntime} from '../utils/verified-chia-runtime';
import fixture from '../utils/generation-sgt-review.fixture.json';

describe('New-generation administrator SGT signing',()=>{
  const runtime=environment.solslotProtocol as {generationId?:string};
  let prior:string|undefined,chia:any,sage:any;
  beforeAll(async()=>{await initializeVerifiedChiaRuntime();});
  beforeEach(()=>{
    prior=runtime.generationId;runtime.generationId=fixture.generationId;
    chia=(window as any).chia;sage=(window as any).sage;
    spyOn(Date,'now').and.returnValue(fixture.nowSeconds*1000);
    TestBed.configureTestingModule({providers:[{provide:ChiaWasmService,useValue:{}},{provide:GoogleBlsWalletService,useValue:{}}]});
  });
  afterEach(()=>{
    if(prior===undefined)delete runtime.generationId;else runtime.generationId=prior;
    (window as any).chia=chia;(window as any).sage=sage;
  });
  for(const v of fixture.vectors)it('matches the native '+v.name+' commitment',()=>{
    const result=inspectGenerationSgt(v.request as GenerationSgtRequest,v.context as GenerationSgtContext);
    expect(result.authorizationHash).toBe(v.expected.authorizationHash);
    expect(result.transitionDigest).toBe(v.expected.transitionDigest);
  });
  for(const source of ['goby','sage'] as const){
    it('executes the exact BLS spend before '+source+' and sends no fee inputs',async()=>{
      const v=fixture.vectors.find(v=>v.name==='bls-lock')!,calls:any[]=[];
      const wallet={chainId:'testnet11',selectedAddress:'txch1test',request:async(p:any)=>{
        calls.push(p);
        if(p.method.toLowerCase().includes('getpublickeys'))return [v.context.owner.publicKey];
        return '0x'+'aa'.repeat(96);
      }};
      (window as any)[source==='goby'?'chia':'sage']=wallet;
      const service=TestBed.inject(ChiaWalletService);
      (service as any)._state.set({kind:'connected',pubkey:v.context.owner.publicKey,connection:source});
      const refresh=jasmine.createSpy('primary inputs').and.resolveTo();
      const signed=await service.signGenerationSgt(v.request as GenerationSgtRequest,v.context as GenerationSgtContext,refresh);
      expect(signed.coinSpends.length).toBe(1);expect(signed.coinSpends[0].coin.amount).toBe(1);
      expect(calls.filter(c=>c.method.toLowerCase().includes('signcoinspends')).length).toBe(1);
      expect(refresh).toHaveBeenCalledTimes(3);
      await expectAsync(service.signSpendBundle(signed.coinSpends)).toBeRejectedWithError(/exact new-generation action/);
    });
    it('stops '+source+' after an account/network change during reconciliation',async()=>{
      const v=fixture.vectors.find(v=>v.name==='bls-lock')!,request=jasmine.createSpy().and.resolveTo([v.context.owner.publicKey]);
      const wallet={chainId:'testnet11',selectedAddress:'txch1test',request};
      (window as any)[source==='goby'?'chia':'sage']=wallet;
      const service=TestBed.inject(ChiaWalletService);
      (service as any)._state.set({kind:'connected',pubkey:v.context.owner.publicKey,connection:source});
      await expectAsync(service.signGenerationSgt(v.request as GenerationSgtRequest,v.context as GenerationSgtContext,
        async()=>{wallet.chainId='mainnet';})).toBeRejectedWithError(/network changed/);
      expect(request).not.toHaveBeenCalled();
    });
  }
  it('rechecks inputs and owner before the EVM prompt and verifies the returned signature',async()=>{
    const v=fixture.vectors.find(v=>v.name==='evm-lock')!,wallet=new Wallet('0x'+'48'.repeat(32)); // Public synthetic fixture key.
    const calls:any[]=[];
    const provider={request:async(p:any)=>{
      calls.push(p);
      if(p.method==='eth_chainId')return '0xaa36a7';
      if(p.method==='eth_accounts')return [wallet.address];
      if(p.method==='eth_signTypedData_v4'){
        const t=JSON.parse(p.params[1]),{EIP712Domain,...types}=t.types;
        return wallet.signTypedData(t.domain,types,t.message);
      }
      throw new Error('Unexpected RPC '+p.method);
    }};
    const service=TestBed.inject(EvmWalletService);
    (service as any).eip1193=provider;(service as any)._state.set({kind:'connected',address:wallet.address,connection:'injected'});
    const refresh=jasmine.createSpy().and.resolveTo();
    const signed=await service.signGenerationSgt(v.request as GenerationSgtRequest,v.context as GenerationSgtContext,refresh);
    expect(signed.length).toBe(132);expect(refresh).toHaveBeenCalledTimes(2);
    expect(calls.filter(c=>c.method==='eth_signTypedData_v4').length).toBe(1);
    await expectAsync(service.signTypedData(v.request.typedData!)).toBeRejectedWithError(/exact SGT holding/);
  });
});
