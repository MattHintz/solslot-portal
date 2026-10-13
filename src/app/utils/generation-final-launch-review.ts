import {sha256,toUtf8Bytes} from 'ethers';
import {FinalLaunchReview,FinalLaunchStatus} from '../services/generation-final-launch.service';
import {Eip712TypedData} from '../services/solslot-api.service';
import {deploymentGeneration} from './deployment-generation';
import {canonicalConsent} from './generation-consent-review';
import {validateGenerationOperations} from '../services/generation-governance.service';
const hash=(v:unknown)=>typeof v==='string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v);
const integer=(v:unknown):v is number=>typeof v==='number' && Number.isSafeInteger(v) && v>=0;
const fail=()=>{throw new Error('The final launch differs from this generation, release or exact recipient review.');};
export function finalLaunchPayload(r:FinalLaunchReview):Record<string,unknown> {
  const {reviewId,approvedSlots,launchComplete,confirmedHeight,lastCheckedAt,errorCode,...payload}=r;
  return payload;
}
export function finalLaunchHash(payload:unknown):string {
  // Match Python's canonical ensure_ascii JSON, including surrogate pairs.
  const ascii=canonicalConsent(payload).replace(/[^\x00-\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  return sha256(toUtf8Bytes(ascii));
}
export function validateFinalLaunch(value:FinalLaunchStatus):FinalLaunchStatus {
  const s=structuredClone(value),g=deploymentGeneration(),r=s.review;
  if(!g || s.generationId!==g || s.network!=='testnet11' || ![1,2,3].includes(s.assignedSlot) || typeof s.enabled!=='boolean')fail();
  if(!r){if(s.operation)fail();return s;}
  if(r.generationId!==g || r.network!=='testnet11' || ![r.reviewId,r.preparationManifest,r.artifactHash,r.certificateHash,
    r.assemblyHash,r.releaseManifestHash,r.securityReviewHash,r.backupReceiptHash,r.restoreReceiptHash,r.sgtTailHash,r.readAnchorHash].every(hash) ||
    !integer(r.issuedAt) || !r.issuedAt || r.expiresAt-r.issuedAt!==86400 || !integer(r.releaseExpiresAt) || r.releaseExpiresAt<=r.issuedAt || !integer(r.feeCapMojos) || r.feeCapMojos>1000000000 ||
    !Array.isArray(r.recipients) || r.recipients.length!==3 || r.recipients.some((a,i)=>a.administratorSlot!==i+1 || a.amount!==10000 ||
      !a.name || !/^0x[0-9a-f]{40}$/.test(a.wallet) || ![a.identityAuthority,a.recipientVault,a.recipientPuzzle,a.fundingCoinId].every(hash) ||
      a.identityAuthority===a.recipientVault) || new Set(r.recipients.map(a=>a.recipientVault)).size!==3 ||
    new Set(r.recipients.map(a=>a.wallet)).size!==3 || r.supply.total!==1000000 || r.supply.distributed!==30000 ||
    r.supply.reserve!==970000 || r.supply.quorum!==15000 || r.exchangeFees.totalBps!==100 || r.exchangeFees.protocolBps!==70 || r.exchangeFees.sgtRewardsBps!==30 ||
    Object.keys(r.sourceCommits).sort().join()!==['protocol','evm','omnichain','api','legacyBackend','keyOfSolomon','samuel','customerWeb','adminPortal'].sort().join() ||
    Object.values(r.sourceCommits).some(v=>!/^[0-9a-f]{40}$/.test(v) || /^0+$/.test(v)) ||
    !Array.isArray(r.approvedSlots) || r.approvedSlots.some(n=>![1,2,3].includes(n)) || new Set(r.approvedSlots).size!==r.approvedSlots.length ||
    typeof r.launchComplete!=='boolean' || (r.launchComplete && (!integer(r.confirmedHeight) || !r.confirmedHeight)) ||
    finalLaunchHash(finalLaunchPayload(r))!==r.reviewId)fail();
  if(!Array.isArray(r.sgtOutputs) || r.sgtOutputs.length!==4 || r.sgtOutputs.some((o,i)=>
    ![o.coinId,o.puzzleHash,o.ownerPuzzleHash].every(hash) || o.amount!==(i===3?970000:10000) ||
    (i<3 && o.ownerPuzzleHash!==r.recipients[i].recipientPuzzle)) || new Set(r.sgtOutputs.map(o=>o.coinId)).size!==4)fail();
  if(s.operation){
    validateGenerationOperations({generationId:g!,network:'testnet11',available:true,operations:[s.operation],
      executionEnabled:s.enabled,maximumFeeMojos:String(r.feeCapMojos),pollAfterSeconds:5});
    const v=s.operation.review;
    if(s.operation.kind!=='INITIALIZE_GENERATION' || v?.kind!=='INITIALIZE_GENERATION' || v.reviewId!==r.reviewId ||
      v.certificateHash!==r.certificateHash || v.preparationManifest!==r.preparationManifest || v.artifactHash!==r.artifactHash)fail();
  }
  return s;
}
export function finalLaunchTypedData(r:FinalLaunchReview,slot:number):Eip712TypedData {
  const fields=[['reviewId','bytes32'],['preparationManifest','bytes32'],['artifactHash','bytes32'],['certificateHash','bytes32'],
    ['assemblyHash','bytes32'],['administratorSlot','uint8'],['issuedAt','uint64'],['expiresAt','uint64'],['feeCapMojos','uint64']];
  return {types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'salt',type:'bytes32'}],
    SolslotGenerationLaunch:fields.map(([name,type])=>({name,type}))},primaryType:'SolslotGenerationLaunch',
    domain:{name:'Solslot generation launch',version:'1',salt:r.generationId},
    message:Object.fromEntries(fields.map(([name])=>[name,name==='administratorSlot'?slot:r[name as keyof FinalLaunchReview]])) as Eip712TypedData['message']};
}
export function validateFinalLaunchSignature(data:Eip712TypedData,status:FinalLaunchStatus,wallet:string):Eip712TypedData {
  const s=validateFinalLaunch(status),r=s.review,now=Math.floor(Date.now()/1000);
  if(!r || !s.enabled || r.launchComplete || wallet.toLowerCase()!==r.recipients[s.assignedSlot-1].wallet || now<r.issuedAt || now>=r.expiresAt || now>=r.releaseExpiresAt)fail();
  const expected=finalLaunchTypedData(r!,s.assignedSlot);
  if(canonicalConsent(expected)!==canonicalConsent(data))fail();
  return expected;
}
