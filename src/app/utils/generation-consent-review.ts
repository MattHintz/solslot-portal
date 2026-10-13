/** Reconstruct the human-reviewed action before any administrator prompt. */
import { getBytes,sha256,toUtf8Bytes,TypedDataEncoder } from 'ethers';
import { environment } from '../../environments/environment';
import type { GenerationConsentReview } from '../services/generation-consent.service';
import { deploymentGeneration } from './deployment-generation';
import { coinId } from './chia-hash';
import { atom,ClvmData,joinBytes,list,pair,uintAtom } from './strict-clvm';
import { snapshotGenerationReview } from './generation-sgt-review';
import { TESTNET11_GENESIS_CHALLENGE_HEX } from '../services/eip712-leaf-hash.service';
import { reconstructGovernedBill,validateStatuteIntent } from './generation-governed-bill';
import { validateMintReview } from './generation-mint-review';

const ADMIN_ACTION='0xece0bc9183193a0d17fd62ef41c68a900e6481c13a5dff5b708b17b3a7e0923b';
const IDENTITY_ACTION='0x37d216ee6ed5a4488e73fe3e8eb4294f19a1154faacb17c095220b40df972b94';
const SINGLETON='0x7faa3253bfddd1e0decb0906b2dc6247bbc4cf608f58345d173adb63e8b47c9f';
const LAUNCHER='0xeff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9';
export const REHEARSAL_SUCCESSOR='0x13800cce50435ae930c73138489094f3f3f48074e26819a9e3aa59457a5c0b7d';
const check=(ok:unknown)=>{if(!ok)throw new Error('The saved approval differs from the reviewed generation or action.');};
const hash=(s:unknown):s is string=>typeof s==='string' && /^0x[0-9a-f]{64}$/.test(s) && !/^0x0+$/.test(s);
const uint=(n:unknown):n is number=>typeof n==='number' && Number.isSafeInteger(n) && n>=0;
const a=(s:string)=>{check(hash(s));return atom(getBytes(s));};
const n=(v:number)=>{check(uint(v));return atom(uintAtom(BigInt(v)));};
const t=(s:string)=>atom(new TextEncoder().encode(s));
const nil=()=>atom(new Uint8Array());
const hp=(l:string,r:string)=>sha256(joinBytes([Uint8Array.of(2),getBytes(l),getBytes(r)]));
const hl=(items:string[])=>items.reduceRight((tail,head)=>hp(head,tail),nil().hash);
function curryHashes(module:string,args:string[]):string {
  let env=n(1).hash;
  for(let i=args.length-1;i>=0;i--)env=hl([n(4).hash,hp(n(1).hash,args[i]),env]);
  return hl([n(2).hash,hp(n(1).hash,module),env]);
}
function curry(module:string,args:ClvmData[]):string {return curryHashes(module,args.map(v=>v.hash));}
function structure(id:string):ClvmData {return pair(a(SINGLETON),pair(a(id),a(LAUNCHER)));}
export function canonicalConsent(value:any):string {
  if(Array.isArray(value))return '['+value.map(canonicalConsent).join(',')+']';
  if(value && typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalConsent(value[k])).join(',')+'}';
  return JSON.stringify(value);
}

/** Validation is independent of the server's proposed delegated hash. */
export function validateGenerationConsent(source:GenerationConsentReview):GenerationConsentReview {
  const r=snapshotGenerationReview(source),gen=deploymentGeneration();
  check(gen && r.generationId===gen && r.network==='testnet11' && hash(r.packageId) && hash(r.requestDigest) &&
    ['PUBLICATION_APPROVAL','PAUSE_NEW_OPERATIONS'].includes(r.kind) &&
    ['AWAITING_APPROVALS','READY','EXPIRED'].includes(r.stage) && [1,2].includes(r.coadministratorSlot) &&
    uint(r.createdAt) && r.createdAt>0 && r.expiresAt===r.createdAt+86400 && uint(r.authorityVersion) && r.authorityVersion>0 &&
    uint(r.governanceNonce) && uint(r.pauseEpoch) && uint(r.eligibleSupply) && r.eligibleSupply<=1_000_000 &&
    r.eligibleTotal===1_000_000 && hash(r.holdingsRoot) && /^\d{1,10}$/.test(r.feeCapMojos) && BigInt(r.feeCapMojos)<=1_000_000_000n);
  check([r.authorityLauncherId,r.authorityCoinId,r.authorityPuzzleHash,r.authorityInnerHash,r.sourceManifestHash,
    r.targetPuzzleHash,r.authorityDelegatedHash,...Object.values(r.expectedInputs).filter(v=>typeof v==='string')].every(hash));
  const req=r.request;
  check(req && sha256(toUtf8Bytes(canonicalConsent(req)))===r.requestDigest && req.generationId===r.generationId &&
    req.kind===r.kind && req.requestKey===r.requestKey && req.coadministratorSlot===r.coadministratorSlot &&
    String(req.feeCapMojos)===r.feeCapMojos && canonicalConsent(req.expectedInputs)===canonicalConsent(r.expectedInputs) &&
    (req.scope??null)===r.scope && (r.kind==='PUBLICATION_APPROVAL'?req.proposalKind===r.proposal?.kind:!req.proposalKind));
  const frozen=environment.solslotProtocol;
  check(hash(frozen.adminAuthorityV3LauncherId) && r.authorityLauncherId===frozen.adminAuthorityV3LauncherId &&
    frozen.adminAuthorityV3IdentityLauncherIds.length===3 && r.identityLauncherIds.length===3 &&
    r.identityLauncherIds.every((v,i)=>v===frozen.adminAuthorityV3IdentityLauncherIds[i] && hash(v)) &&
    r.identityCoins.length===3 && r.identityCustodies.length===3 && r.identityPuzzles.length===3 &&
    r.identityCustodies.every(hash) && r.identityPuzzles.every(hash));
  const coin=r.authorityCoin;
  check(coin.amount===1 && hash(coin.parent_coin_info) && coin.puzzle_hash===r.authorityPuzzleHash &&
    coinId(coin.parent_coin_info,coin.puzzle_hash,coin.amount)===r.authorityCoinId &&
    curryHashes(SINGLETON,[structure(r.authorityLauncherId).hash,r.authorityInnerHash])===coin.puzzle_hash);
  r.identityCoins.forEach((c,i)=>check(c.amount===2*i+3 && hash(c.parent_coin_info) && c.puzzle_hash===r.identityPuzzles[i] &&
    curryHashes(SINGLETON,[structure(r.identityLauncherIds[i]).hash,r.identityCustodies[i]])===c.puzzle_hash));
  let subject:ClvmData;
  if(r.kind==='PUBLICATION_APPROVAL'){
    check(r.issuedAt===r.createdAt && r.eligibleSupply>0 && r.requiredVotes===Math.ceil(r.eligibleSupply/2) &&
      hash(r.proposalId) && hash(r.billHash) && r.proposal && r.proposal.billHash===r.billHash);
    const p=r.proposal!;
    check(['UPGRADE','PARAMETERS','STATUTES','REOPEN','MINT_TEST_ONLY','FUND_REDEMPTION'].includes(p.kind));
    const bill=reconstructGovernedBill(p);
    if(p.kind==='UPGRADE'){
      check(canonicalConsent(p.upgrade)===canonicalConsent(req.upgrade));
    }else if(p.kind==='PARAMETERS'){
      check(canonicalConsent(p.parameters)===canonicalConsent(req.parameters));
    }else if(p.kind==='FUND_REDEMPTION'){
      check(canonicalConsent(p.redemption)===canonicalConsent(req.redemption) && !req.parameters && !req.statutes && !req.upgrade &&
        !req.mintReviewId && r.scope===null && Object.keys(r.expectedInputs.components??{}).length===0);
    }else if(p.kind==='STATUTES'){
      check(req.statutes && p.statutes);
      validateStatuteIntent(req.statutes!);
      const {currentRecords,...review}=req.statutes!;
      check(canonicalConsent(p.statutes)===canonicalConsent(review) &&
        canonicalConsent(r.expectedInputs.components)===canonicalConsent({[review.componentId]:r.expectedInputs.components?.[review.componentId]}) &&
        hash(r.expectedInputs.components?.[review.componentId]));
    }else if(p.kind==='MINT_TEST_ONLY'){
      check(r.mintSource && req.mintReviewId===r.mintSource.packageId && !req.upgrade && !req.parameters && r.scope===null);
      const source=validateMintReview(r.mintSource!);
      check(source.generationId===r.generationId && source.billHash===r.billHash &&
        p.testMint?.collectionId===source.collectionCommitment && p.testMint?.editionHash===source.editionHash &&
        p.testMint?.deedCount===source.funding.length &&
        canonicalConsent(r.expectedInputs.components)===canonicalConsent({[source.mintAuthority.componentId]:source.mintAuthority.coinId}));
    }else{
      check(p.kind==='REOPEN' && p.pauseEpoch===r.pauseEpoch && p.scope===r.scope && uint(r.scope) && r.scope>0 && r.scope<32);
    }
    check(bill.hash===r.billHash && list([t('HOLDER_PROPOSAL_V1'),a(r.generationId),n(r.governanceNonce),bill,
      list([a(r.holdingsRoot),n(r.eligibleSupply),n(r.eligibleTotal)])]).hash===r.proposalId);
    subject=a(r.proposalId!);
  }else{
    check(r.issuedAt===0 && r.proposal===null && r.proposalId===null && r.billHash===null && r.requiredVotes===null &&
      uint(r.scope) && r.scope>0 && r.scope<32);
    subject=list([n(r.pauseEpoch),n(r.scope!)]);
  }
  check(r.proposal?.kind==='MINT_TEST_ONLY' || (!r.mintSource && !req.mintReviewId));
  const expires=r.kind==='PUBLICATION_APPROVAL'?r.expiresAt:0;
  const delegated=curry(ADMIN_ACTION,[a(r.generationId),a(r.targetPuzzleHash),t(r.kind),subject,n(r.issuedAt),n(expires)]);
  check(delegated===r.authorityDelegatedHash && r.challenges.length===2 && r.challenges[0].slot===0 &&
    r.challenges[1].slot===r.coadministratorSlot);
  for(const c of r.challenges){
    const i=c.slot,coin=r.identityCoins[i];
    check(/^0x0[23][0-9a-f]{64}$/.test(c.publicKey) && hash(c.coinId) && hash(c.digest) &&
      c.coinId===coinId(coin.parent_coin_info,coin.puzzle_hash,coin.amount));
    const action=curry(IDENTITY_ACTION,[n(2),a(r.identityCustodies[i]),a(r.authorityPuzzleHash),a(delegated),nil(),nil(),a(coin.puzzle_hash),n(coin.amount)]);
    check(c.delegatedPuzzleHash===action);
    const typed={domain:{name:'Chia Coin Spend',version:'1',salt:'0x'+TESTNET11_GENESIS_CHALLENGE_HEX},primaryType:'ChiaCoinSpend',
      types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'salt',type:'bytes32'}],
        ChiaCoinSpend:[{name:'coin_id',type:'bytes32'},{name:'delegated_puzzle_hash',type:'bytes32'}]},
      message:{coin_id:c.coinId,delegated_puzzle_hash:action}};
    check(canonicalConsent(c.typedData)===canonicalConsent(typed));
    const types={...c.typedData.types};delete types['EIP712Domain'];
    check(c.typedData.message['coin_id']===c.coinId && c.typedData.message['delegated_puzzle_hash']===action &&
      TypedDataEncoder.hash(c.typedData.domain,types,c.typedData.message)===c.digest);
  }
  check(r.signatures.length<=2 && new Set(r.signatures.map(s=>s.slot)).size===r.signatures.length &&
    r.signatures.every(s=>r.challenges.some(c=>c.slot===s.slot) && uint(s.signedAt) && s.signedAt>=r.createdAt && s.signedAt<r.expiresAt) &&
    (r.stage!=='READY' || r.signatures.length===2));
  return r;
}
