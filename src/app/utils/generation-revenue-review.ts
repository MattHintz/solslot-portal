/** Independent public puzzle-hash reconstruction before final consent. */
import {getBytes,sha256} from 'ethers';
import {atom,joinBytes,pair,uintAtom} from './strict-clvm';
import type {FinalLaunchReview} from '../services/generation-final-launch.service';
const REVENUE='0x0e903f37c7761a8959a24e2f76506cf2e197e10b0b38b31ea75aae1f53211c52';
const BACKING='0xae7c406cee3433e51683e2a8e15d22ba79f87f2c4464c62b75288c0c25def3b3';
const SINGLETON='0x7faa3253bfddd1e0decb0906b2dc6247bbc4cf608f58345d173adb63e8b47c9f';
const LAUNCHER='0xeff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9';
const a=(v:string)=>atom(getBytes(v));
const n=(v:number)=>atom(uintAtom(BigInt(v)));
const hp=(l:string,r:string)=>sha256(joinBytes([Uint8Array.of(2),getBytes(l),getBytes(r)]));
const hl=(xs:string[])=>xs.reduceRight((tail,head)=>hp(head,tail),atom(new Uint8Array()).hash);
function curry(module:string,args:string[]):string {
  let env=n(1).hash;
  for(let i=args.length-1;i>=0;i--)env=hl([n(4).hash,hp(n(1).hash,args[i]),env]);
  return hl([n(2).hash,hp(n(1).hash,module),env]);
}
export function validateRevenueCustody(r:FinalLaunchReview):void {
  const c=r.custody,v=c?.companyRevenue;
  const fail=()=>{throw new Error('Company revenue and protected custody differ from the reviewed contract policy.');};
  if(!c || c.policy!=='SEGREGATED_COMPANY_REVENUE_V1' || !v || v.policy!=='COMPANY_REVENUE_OWNER_PLUS_ONE_V1' ||
    v.generationId!==r.generationId || !/^0x[0-9a-f]{64}$/.test(v.authorityId) || /^0x0+$/.test(v.authorityId) ||
    v.moduleHash!==REVENUE || v.operatingExpensesAllowed!==true || v.reinvestmentAllowed!==true ||
    v.standingWithdrawalBudget!==false || v.serverSpendingKey!==false || v.maxNetworkFeeMojos!==1000000000 ||
    v.maxApprovalSeconds!==86400 || v.protectedCustomerAndRewardFunds!=='SEPARATE_CONTRACTS' ||
    c.sgtRewards!=='SEPARATE_HOLDER_CLAIMS' || c.redemptions!=='SEPARATE_ISSUER_FUNDED_LEAVES' ||
    !/^0x[0-9a-f]{64}$/.test(c.primaryFeeSplitter) || /^0x0+$/.test(c.primaryFeeSplitter))fail();
  const structure=pair(a(SINGLETON),pair(a(v.authorityId),a(LAUNCHER)));
  const revenue=curry(REVENUE,[a(REVENUE).hash,a(r.generationId).hash,structure.hash]);
  const backing=curry(BACKING,[a(BACKING).hash,a(r.generationId).hash]);
  if(v.custodyPuzzleHash!==revenue || c.nonwithdrawableBacking!==backing || v.backingCustody!==backing ||
    c.primaryFeeSplitter===revenue || c.primaryFeeSplitter===backing || revenue===backing)fail();
}
