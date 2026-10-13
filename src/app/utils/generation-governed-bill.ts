/** Reconstruct the exact consensus bill from its human-readable review. */
import { getBytes,toUtf8Bytes } from 'ethers';
import { atom,ClvmData,list,uintAtom } from './strict-clvm';

export interface UpgradeIntent {sourceManifestHash:string;changes:Array<{componentId:string;oldModuleHash:string;
  newModuleHash:string;nextVersion:number;compatibility:number;transition:'PRESERVE_STATE'}>;}
export interface ParameterIntent {componentId:string;launcherId:string;revision:number;previousValuesHash:string;
  values:[number,number,number,number,number,number];}
export interface TestMintIntent {purpose:'TEST_ONLY';collectionId:string;editionHash:string;deedCount:number;}
export interface GrantIntent {reserveCoinId:string;outputs:Array<{kind:3|4;ownerPuzzleHash:string;lockId:null;amount:number}>;}
export type StatuteKind='COLLECTION'|'ORACLE'|'ROUTE'|'LIQUIDITY';
export interface StatuteReview {componentId:string;launcherId:string;revision:number;recordKind:StatuteKind;
  key:string;record:Array<number|string>;previousRoot:string;nextRoot:string;}
export interface StatuteIntent extends StatuteReview {currentRecords:Array<Array<number|string>>;}
export interface RedemptionIntent {treasuryCoinId:string;treasuryParentId:string;collectionId:string;settlementId:string;
  paymentAssetId:string;totalPaymentAmount:number;deedLauncherPuzzleHash:string;
  allocations:Array<{deedLauncherId:string;deedCommitment:string;sharePpm:number;paymentAmount:number}>;}
export interface GovernedBill {kind:string;billHash:string;upgrade?:UpgradeIntent;parameters?:ParameterIntent;
  registryNonce?:number;scope?:number;pauseEpoch?:number;testMint?:TestMintIntent;grant?:GrantIntent;statutes?:StatuteReview;redemption?:RedemptionIntent;}

export function governedBillLabel(kind:string):string {
  return ({UPGRADE:'code upgrade',PARAMETERS:'parameter change',REOPEN:'reopening',
    MINT_TEST_ONLY:'test SmartDeed mint',GRANT:'SGT allocation',STATUTES:'governed economic fact',FUND_REDEMPTION:'fund permanent redemption claims'} as Record<string,string>)[kind] ?? 'reviewed proposal';
}

const hash=(s:unknown):s is string=>typeof s==='string' && /^0x[0-9a-f]{64}$/.test(s) && !/^0x0+$/.test(s);
const uint=(v:unknown):v is number=>Number.isSafeInteger(v) && (v as number)>=0;
const check=(v:unknown)=>{if(!v)throw new Error('The proposal details do not match its exact consensus bill.');};
const a=(v:string)=>{check(hash(v));return atom(getBytes(v));};
const n=(v:number)=>{check(uint(v));return atom(uintAtom(BigInt(v)));};
const t=(v:string)=>atom(toUtf8Bytes(v));

function statuteRecord(kind:StatuteKind,record:Array<number|string>):ClvmData {
  const shapes={COLLECTION:[7,[0]],ORACLE:[10,[0,5]],ROUTE:[7,[0,1,2,3,4]],LIQUIDITY:[9,[0,1,2,3,4,5,6,7]]} as const;
  const shape=shapes[kind];check(shape && Array.isArray(record) && record.length===shape[0]);
  const hashes:readonly number[]=shape[1];
  const values=record.map((v,i)=>hashes.includes(i)?a(v as string):n(v as number));
  const v=record as any;
  if(kind==='COLLECTION')check(v[1]>0 && v[2]>=v[1] && v[3]>0 && v[5]>v[4] && [1,2,3].includes(v[6]));
  if(kind==='ORACLE')check(v[1]>0 && v[3]>v[2] && v[4]>0 && v[6]>=2 && v[7]<=10000 &&
    (v[8]===0?v[9]===0:v[8]>=1 && v[9]>=v[8] && v[9]<=20000));
  if(kind==='ROUTE')check(v[5]<=18 && [0,1].includes(v[6]));
  if(kind==='LIQUIDITY')check(v[5]!==v[6] && [0,1].includes(v[8]));
  return list(values);
}

export function validateStatuteIntent(v:StatuteIntent):void {
  check(v && Array.isArray(v.currentRecords) && v.currentRecords.length<=32);
  statuteReviewBill(v);
  const records=v.currentRecords,keys=records.map(r=>r[0] as string);
  check(keys.every(hash) && keys.every((key,i)=>i===0 || key>keys[i-1]));
  const old=list(records.map(r=>statuteRecord(v.recordKind,r)));
  check(old.hash===v.previousRoot);
  const prior=records.find(r=>r[0]===v.key),next=[...records.filter(r=>r[0]!==v.key),v.record]
    .sort((a,b)=>(a[0] as string)<(b[0] as string)?-1:1);
  check(list(next.map(r=>statuteRecord(v.recordKind,r))).hash===v.nextRoot && v.nextRoot!==v.previousRoot);
  if(v.recordKind==='COLLECTION')check(v.record[3]===(prior?(prior[3] as number)+1:1));
  if(v.recordKind==='ORACLE')check(v.record[4]===(prior?(prior[4] as number)+1:1) &&
    (!prior || (v.record[2] as number)>=(prior[2] as number)));
}

export function statuteReviewBill(s:StatuteReview):ClvmData {
  check(s && [s.componentId,s.launcherId,s.key,s.previousRoot,s.nextRoot].every(hash) &&
    uint(s.revision) && s.previousRoot!==s.nextRoot && s.record?.[0]===s.key);
  return list([t('STATUTES'),a(s.componentId),a(s.launcherId),n(s.revision),t(s.recordKind),a(s.key),
    statuteRecord(s.recordKind,s.record),a(s.previousRoot),a(s.nextRoot)]);
}

export function redemptionReviewBill(v:RedemptionIntent):ClvmData {
  check(v && [v.treasuryCoinId,v.treasuryParentId,v.collectionId,v.settlementId,v.paymentAssetId,v.deedLauncherPuzzleHash].every(hash) &&
    uint(v.totalPaymentAmount) && v.totalPaymentAmount>0 && Array.isArray(v.allocations) && v.allocations.length>0 && v.allocations.length<=100);
  let shares=0n,payments=0n;const commitments=new Set<string>();let previous='';
  const rows=v.allocations.map(row=>{
    check([row.deedLauncherId,row.deedCommitment].every(hash) && row.deedLauncherId>previous && !commitments.has(row.deedCommitment) &&
      uint(row.sharePpm) && row.sharePpm>0 && row.sharePpm<=1_000_000 && uint(row.paymentAmount) && row.paymentAmount>0);
    previous=row.deedLauncherId;commitments.add(row.deedCommitment);shares+=BigInt(row.sharePpm);payments+=BigInt(row.paymentAmount);
    return list([a(row.deedLauncherId),a(row.deedCommitment),n(row.sharePpm),n(row.paymentAmount)]);
  });
  check(shares===1000000n && payments===BigInt(v.totalPaymentAmount));
  return list([t('FUND_REDEMPTION'),a(v.treasuryParentId),a(v.collectionId),a(v.settlementId),a(v.paymentAssetId),n(v.totalPaymentAmount),
    list(rows),a(v.deedLauncherPuzzleHash),a(v.treasuryCoinId)]);
}

/** This authorizes nothing by itself. Wallet guards also verify native inputs,
 * custody, snapshots and the proposal commitment. No RPC or signing occurs. */
export function reconstructGovernedBill(p:GovernedBill,reserveOwner?:string):ClvmData {
  check(p && hash(p.billHash));
  const allowed:Record<string,string[]>={UPGRADE:['upgrade','registryNonce'],PARAMETERS:['parameters'],
    REOPEN:['scope','pauseEpoch'],MINT_TEST_ONLY:['testMint'],GRANT:['grant'],STATUTES:['statutes'],FUND_REDEMPTION:['redemption']};
  const fields=allowed[p.kind];check(fields);
  // Reject contradictory effects instead of displaying unrelated optional data.
  for(const key of ['upgrade','registryNonce','parameters','scope','pauseEpoch','testMint','grant','statutes','redemption'])
    check(fields.includes(key) || (p as any)[key]===undefined);
  let bill:ClvmData;
  if(p.kind==='UPGRADE'){
    const u=p.upgrade;check(u && hash(u.sourceManifestHash) && uint(p.registryNonce) && Array.isArray(u.changes) &&
      u.changes.length>0 && u.changes.length<=32 && new Set(u.changes.map(c=>c.componentId)).size===u.changes.length);
    bill=list([t('UPGRADE'),n(p.registryNonce!),list([a(u!.sourceManifestHash),list(u!.changes.map(c=>{
      check([c.componentId,c.oldModuleHash,c.newModuleHash].every(hash) && c.oldModuleHash!==c.newModuleHash && uint(c.nextVersion) && c.nextVersion>0 &&
        uint(c.compatibility) && c.compatibility>0 && c.transition==='PRESERVE_STATE');
      return list([a(c.componentId),a(c.oldModuleHash),a(c.newModuleHash),n(c.nextVersion),n(c.compatibility),t('PRESERVE_STATE')]);
    }))])]);
  }else if(p.kind==='PARAMETERS'){
    const v=p.parameters;check(v && [v.componentId,v.launcherId,v.previousValuesHash].every(hash) && uint(v.revision) &&
      Array.isArray(v.values) && v.values.length===6 && v.values.every(uint));
    const [nav,oracle,total,protocol,sgt,epoch]=v!.values;
    check(nav>=60 && nav<=2592000 && oracle>=30 && oracle<=3600 && total<=100 && protocol+sgt===total && epoch>=60 && epoch<=2592000);
    bill=list([t('PARAMETERS'),a(v!.componentId),a(v!.launcherId),n(v!.revision),a(v!.previousValuesHash),list(v!.values.map(n))]);
  }else if(p.kind==='STATUTES'){
    bill=statuteReviewBill(p.statutes!);
  }else if(p.kind==='FUND_REDEMPTION'){
    bill=redemptionReviewBill(p.redemption!);
  }else if(p.kind==='REOPEN'){
    check(uint(p.pauseEpoch) && uint(p.scope) && p.scope!>0 && p.scope!<=31);
    bill=list([t('REOPEN'),n(p.pauseEpoch!),n(p.scope!)]);
  }else if(p.kind==='MINT_TEST_ONLY'){
    const m=p.testMint;check(m && m.purpose==='TEST_ONLY' && hash(m.collectionId) && hash(m.editionHash) &&
      uint(m.deedCount) && m.deedCount>0 && m.deedCount<=100);
    bill=list([t('MINT_TEST_ONLY'),a(m!.collectionId),a(m!.editionHash),n(m!.deedCount)]);
  }else{
    const g=p.grant;check(g && hash(g.reserveCoinId) && Array.isArray(g.outputs) && g.outputs.length>0 && g.outputs.length<=32);
    let total=0;const seen=new Set<string>();
    const outputs=g!.outputs.map(o=>{
      check([3,4].includes(o.kind) && hash(o.ownerPuzzleHash) && o.lockId===null && uint(o.amount) && o.amount>0 && o.amount<=1_000_000 &&
        (o.kind!==3 || reserveOwner===undefined || o.ownerPuzzleHash===reserveOwner));
      total+=o.amount;
      const output=list([n(o.kind),a(o.ownerPuzzleHash),atom(new Uint8Array()),n(o.amount)]);
      check(!seen.has(output.hash));seen.add(output.hash);return output;
    });
    check(total<=1_000_000);bill=list([t('GRANT'),a(g!.reserveCoinId),list(outputs)]);
  }
  check(bill.hash===p.billHash);return bill;
}
