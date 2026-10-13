import { environment } from '../../environments/environment';
import { EvmWalletService } from './evm-wallet.service';
import { Eip712TypedData } from './solslot-api.service';

describe('Generation-scoped launch signing',()=>{
  const gen='0x'+'ab'.repeat(32), wallet='0x'+'12'.repeat(20);
  const runtime=environment.solslotProtocol as {generationId?: string};
  let previous:string|undefined;
  beforeEach(()=>{previous=runtime.generationId; runtime.generationId=gen;});
  afterEach(()=>{if(previous===undefined)delete runtime.generationId;else runtime.generationId=previous;});
  for(const salt of [gen,'0x'+'cd'.repeat(32),null]) it('requires the frozen domain for '+salt,async()=>{
    const service=Object.create(EvmWalletService.prototype);
    Object.assign(service,{eip1193:{},address:()=>wallet});
    const signer=spyOn<any>(service,'signTypedDataOnChain').and.resolveTo('synthetic-signature');
    const data:Eip712TypedData={
      domain:{name:'Solslot Alpha Launch',version:'21',chainId:environment.eip712ChainId,...(salt?{salt}:{})},
      primaryType:'SolslotLaunchResume',types:{
        EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},...(salt?[{name:'salt',type:'bytes32'}]:[])],
        SolslotLaunchResume:[{name:'ceremonyId',type:'bytes32'},{name:'slot',type:'uint8'},
          {name:'wallet',type:'address'},{name:'nonce',type:'bytes32'},{name:'expiresAt',type:'uint64'}]},
      message:{ceremonyId:'0x'+'34'.repeat(32),slot:1,wallet,nonce:'0x'+'56'.repeat(32),expiresAt:Math.floor(Date.now()/1000)+300}};
    if(salt===gen){expect(await service.signLaunchAction(data)).toBe('synthetic-signature');expect(signer).toHaveBeenCalledOnceWith(data,environment.eip712ChainId);}
    else{await expectAsync(service.signLaunchAction(data)).toBeRejected();expect(signer).not.toHaveBeenCalled();}
  });

  function ceremony() {
    return {domain:{name:'Solslot Protocol',version:'2',chainId:environment.eip712ChainId,salt:gen},
      primaryType:'SolslotGenesisPlan',types:{
        EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'salt',type:'bytes32'}],
        SolslotGenesisPlan:[{name:'ceremonyId',type:'bytes32'},{name:'rosterHash',type:'bytes32'},{name:'planHash',type:'bytes32'},
          {name:'network',type:'string'},{name:'expiresAt',type:'uint64'}]},
      message:{ceremonyId:'0x'+'11'.repeat(32),rosterHash:'0x'+'22'.repeat(32),planHash:'0x'+'33'.repeat(32),network:'testnet11',expiresAt:Math.floor(Date.now()/1000)+86400}};
  }
  for(const fault of ['none','legacy','other-generation','binding','unexpected-type','changed-while-signing']) {
    it('checks ceremony generation before and after signing: '+fault,async()=>{
      const service=Object.create(EvmWalletService.prototype);
      Object.assign(service,{eip1193:{},address:()=>wallet});
      const data:any=ceremony();
      const binding={ceremonyId:data.message.ceremonyId,evmChainId:environment.eip712ChainId,generationId:gen,planHash:data.message.planHash};
      const signer=spyOn<any>(service,'signTypedDataOnChain').and.callFake(async()=>{
        if(fault==='changed-while-signing')runtime.generationId='0x'+'cd'.repeat(32);
        return 'synthetic-signature';
      });
      if(fault==='legacy'){delete data.domain.salt;data.types.EIP712Domain.pop();}
      if(fault==='other-generation')data.domain.salt='0x'+'cd'.repeat(32);
      if(fault==='binding')binding.generationId='0x'+'cd'.repeat(32);
      if(fault==='unexpected-type')data.types.EIP712Domain[3].type='string';
      if(fault==='none')expect(await service.signLaunchCeremony(data,binding)).toBe('synthetic-signature');
      else await expectAsync(service.signLaunchCeremony(data,binding)).toBeRejected();
      if(['none','changed-while-signing'].includes(fault))expect(signer).toHaveBeenCalledTimes(1);
      else expect(signer).not.toHaveBeenCalled();
    });
  }
});
