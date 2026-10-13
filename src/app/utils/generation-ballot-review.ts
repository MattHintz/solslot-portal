/** Independently bind whole-coin wallet effects to the displayed proposal. */
import { getBytes,sha256,toUtf8Bytes } from 'ethers';
import { environment } from '../../environments/environment';
import type { GenerationBallotReview,HolderCatalog } from '../services/generation-ballot.service';
import { atom,list,uintAtom } from './strict-clvm';
import { deploymentGeneration } from './deployment-generation';
import { canonicalConsent } from './generation-consent-review';
import { inspectGenerationSgt,snapshotGenerationReview } from './generation-sgt-review';
import { reconstructGovernedBill } from './generation-governed-bill';

const hash=(v:unknown):v is string=>typeof v==='string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v);
const uint=(v:unknown):v is number=>Number.isSafeInteger(v) && (v as number)>=0;
const check=(v:unknown)=>{if(!v)throw new Error('Holder review does not match the exact Testnet proposal.');};
const a=(v:string)=>atom(getBytes(v)),t=(v:string)=>atom(toUtf8Bytes(v)),n=(v:number)=>{check(uint(v));return atom(uintAtom(BigInt(v)));};

export function validateHolderCatalog(source:HolderCatalog):HolderCatalog {
  const c=snapshotGenerationReview(source);
  check(c.generationId===deploymentGeneration() && c.network==='testnet11' && c.scope==='FROZEN_GENESIS_ROSTER' && uint(c.checkedAt) && c.checkedAt>0 &&
    hash(c.snapshotRoot) && uint(c.eligibleSupply) && c.eligibleSupply>0 && c.eligibleSupply<=1_000_000 && typeof c.truncated==='boolean' &&
    Array.isArray(c.holdings) && c.holdings.length<=96 && ['registry','governance','holdings'].every(k=>hash(c.expectedInputs[k as 'registry'])) &&
    (c.proposalId===null?c.votingClosesAt===null:hash(c.proposalId) && (c.votingClosesAt===null || uint(c.votingClosesAt))) &&
    new Set(c.holdings.map(r=>r.coinId)).size===c.holdings.length);
  for(const r of c.holdings)check([r.coinId,r.vaultLauncherId,r.ownerPuzzleHash].every(hash) && typeof r.name==='string' && r.name.length>0 && r.name.length<=100 &&
    uint(r.amount) && r.amount>0 && r.amount<=1_000_000);
  return c;
}

export function validateGenerationBallot(source:GenerationBallotReview):GenerationBallotReview {
  // Validate each proof separately; 32 legitimate sparse proofs exceed the
  // per-object node budget and must not make an unbounded aggregate clone.
  check(source && Array.isArray(source.holders) && source.holders.length>0 && source.holders.length<=32);
  const {holders,...metadata}=source;
  const r={...snapshotGenerationReview(metadata),holders:holders.map(row=>snapshotGenerationReview(row))};
  const req=r.request;
  check(r.generationId===deploymentGeneration() && r.network==='testnet11' && hash(r.packageId) && hash(r.requestDigest) &&
    ['OPEN_PROPOSAL','CAST_VOTE'].includes(r.kind) && ['AWAITING_HOLDER_SIGNATURES','READY','EXPIRED'].includes(r.stage) &&
    uint(r.createdAt) && r.createdAt>0 && uint(r.expiresAt) && r.expiresAt>r.createdAt && r.expiresAt<=r.createdAt+86400 &&
    hash(r.proposalId) && hash(r.snapshotRoot) && uint(r.proposalNonce) && uint(r.eligibleSupply) && r.eligibleSupply>0 && r.eligibleSupply<=1_000_000 &&
    r.requiredVotes===Math.ceil(r.eligibleSupply/2) && uint(r.selectedWeight) && r.selectedWeight>0 && r.selectedWeight<=r.eligibleSupply &&
    /^\d{1,10}$/.test(r.feeCapMojos) && BigInt(r.feeCapMojos)<=1_000_000_000n && req && req.kind===r.kind &&
    req.generationId===r.generationId && req.proposalId===r.proposalId && String(req.feeCapMojos)===r.feeCapMojos &&
    /^[a-zA-Z0-9_:-]{1,128}$/.test(req.requestKey) && sha256(toUtf8Bytes(canonicalConsent(req)))===r.requestDigest &&
    Object.keys(req.expectedInputs.components??{}).length===0 && ['registry','governance','holdings'].every(k=>hash(req.expectedInputs[k as 'registry'])) &&
    Array.isArray(req.selected) && req.selected.length===r.holders.length && new Set(req.selected.map(v=>v.coinId)).size===req.selected.length &&
    new Set(req.selected.map(v=>v.vaultLauncherId)).size===req.selected.length &&
    (r.kind==='OPEN_PROPOSAL'?hash(req.consentPackageId) && r.votingClosesAt===null && r.selectedWeight>=10000:
      req.consentPackageId===null && uint(r.votingClosesAt) && r.expiresAt===r.votingClosesAt));
  const p=r.proposal,bill=reconstructGovernedBill(p,environment.solslotProtocol.generationHolderBindings.reserveOwner);
  check(bill.hash===p.billHash && list([t('HOLDER_PROPOSAL_V1'),a(r.generationId),n(r.proposalNonce),bill,
    list([a(r.snapshotRoot),n(r.eligibleSupply),n(1_000_000)])]).hash===r.proposalId);
  const frozen=environment.solslotProtocol.generationHolderBindings;
  check(environment.solslotProtocol.artifactVerified && Object.keys(frozen).length===6 && Object.values(frozen).every(hash));
  let weight=0;
  r.holders.forEach((row,i)=>{
    const c=row.context,w=row.request,selected=req.selected[i];
    check(canonicalConsent(c.bindings)===canonicalConsent(frozen) && c.selection.action==='LOCK' && c.selection.proposalId===r.proposalId &&
      c.selection.snapshotRoot===r.snapshotRoot && c.selection.eligibleSupply===r.eligibleSupply && c.selection.votingClosesAt===r.votingClosesAt &&
      w.sgtCoinId===selected.coinId && c.vault.launcherId===selected.vaultLauncherId && w.expiresAt===r.expiresAt);
    const intent=inspectGenerationSgt(w,c,r.createdAt);
    check(intent.authorizationHash===row.authorizationHash && intent.transitionDigest===row.transitionDigest);
    weight+=c.holding.current.coin.amount;
  });
  check(weight===r.selectedWeight && Array.isArray(r.signatures) && r.signatures.length<=r.holders.length &&
    new Set(r.signatures.map(s=>s.coinId)).size===r.signatures.length && r.signatures.every(s=>req.selected.some(v=>v.coinId===s.coinId) &&
      uint(s.signedAt) && s.signedAt>=r.createdAt && s.signedAt<r.expiresAt) &&
    (r.stage==='EXPIRED' || (r.stage==='READY')===(r.signatures.length===r.holders.length)));
  return r;
}
