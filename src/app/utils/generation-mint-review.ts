/** Read-only batch verification. This review grants no wallet authority. */
import { getBytes, sha256, toUtf8Bytes } from 'ethers';
import { atom, asList, asUint, ClvmData, list, pair, parseClvm, uintAtom, uint64 } from './strict-clvm';
import { coinId } from './chia-hash';
import { deploymentGeneration } from './deployment-generation';
import { snapshotGenerationReview } from './generation-sgt-review';
import { canonicalizeJcs } from '../services/property-metadata/property-metadata.service';
import { SINGLETON_LAUNCHER_WITH_DID_PUZZLE_HEX } from '../services/mint-proposal-v2/singleton-launcher-with-did.puzzle-hex';

export interface MintReviewRequest {generationId:string;collectionId:string;revision:number;metadataRoot:string;previewHash:string;}
export interface GenerationMintReview {
  packageId:string;generationId:string;network:'testnet11';purpose:'TEST_ONLY';stage:'SOURCE_REVIEWED';publicationReady:false;
  createdAt:number;request:MintReviewRequest;requestDigest:string;canonicalMetadata:any;
  editionProgram:string;editionHash:string;billHash:string;collectionCommitment:string;
  mintAuthority:{componentId:string;launcherId:string;coinId:string;moduleHash:string;version:number};
  funding:Array<{coinId:string;coin:{parent_coin_info:string;puzzle_hash:string;amount:number};confirmedHeight:number;launcherId:string;inventoryCoinId:string}>;
  nextAction:string;
}
const check=(ok:unknown)=>{if(!ok)throw new Error('The saved test mint review differs from its sealed edition or funding.');};
const hash=(v:unknown):v is string=>typeof v==='string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v);
const safe=(v:unknown):v is number=>typeof v==='number' && Number.isSafeInteger(v) && v>0;
const a=(s:string)=>{check(hash(s));return atom(getBytes(s));};
const t=(s:string)=>atom(toUtf8Bytes(s));
const n=(v:bigint)=>atom(uintAtom(v));
const curry=(module:ClvmData,args:ClvmData[])=>{
  let env=n(1n);for(let i=args.length-1;i>=0;i--)env=list([n(4n),pair(n(1n),args[i]),env]);
  return list([n(2n),pair(n(1n),module),env]);
};

export function validateMintReview(source:GenerationMintReview):GenerationMintReview {
  const r=snapshotGenerationReview(source),request=r.request,d=r.canonicalMetadata;
  const {packageId,...document}=r;
  check(hash(packageId) && sha256(toUtf8Bytes(canonicalizeJcs(document)))===packageId &&
    r.generationId===deploymentGeneration() && r.network==='testnet11' && r.purpose==='TEST_ONLY' &&
    r.stage==='SOURCE_REVIEWED' && r.publicationReady===false && safe(r.createdAt) && typeof r.nextAction==='string');
  check(request?.generationId===r.generationId && /^[A-Za-z0-9_-]{1,128}$/.test(request.collectionId) && safe(request.revision) &&
    [request.metadataRoot,request.previewHash,r.editionHash,r.billHash,r.collectionCommitment].every(hash) &&
    r.requestDigest===sha256(toUtf8Bytes(canonicalizeJcs(request))) &&
    d?.schemaVersion==='solslot.testnet-property-dossier.v1' && d.purpose==='TEST_ONLY' && d.network==='testnet11' &&
    d.generationId===r.generationId && d.collectionId===request.collectionId && d.revision===request.revision &&
    !('privateDocuments' in d) && sha256(toUtf8Bytes(canonicalizeJcs(d)))===request.metadataRoot);
  const m=r.mintAuthority;
  check(m && [m.componentId,m.launcherId,m.coinId,m.moduleHash].every(hash) && safe(m.version));
  const e=parseClvm(r.editionProgram),fields=asList(e,11);
  check(fields.length===11 && list([t('SOLSLOT_TEST_EDITION_V1'),e]).hash===r.editionHash &&
    fields[0].hash===t('TEST_ONLY').hash && fields[1].hash===a(r.generationId).hash &&
    fields[2].hash===a(r.collectionCommitment).hash && r.collectionCommitment===sha256(toUtf8Bytes(request.collectionId.toUpperCase())) &&
    fields[3].hash===a(request.metadataRoot).hash && fields[4].hash===a(request.previewHash).hash &&
    fields[5].hash===a(sha256(toUtf8Bytes(canonicalizeJcs({schema:'solslot.test-property-address.v1',address:d.property?.address})))).hash &&
    fields[6].hash===a(d.pricingRoundHash).hash && asUint(fields[7])===uint64(d.offering?.royaltyBps));
  const classes=['','RWA-RE-RES','RWA-RE-MFR','RWA-RE-COM','RWA-RE-IND','RWA-RE-HOS','RWA-RE-LAND','RWA-RE-MIX'];
  check(asUint(fields[7])<=1000n && classes[Number(asUint(fields[8]))]===d.offering?.assetClass?.toUpperCase() &&
    fields[9].hash===t(d.offering?.jurisdiction).hash);
  const rows=asList(fields[10],100),allocation=d.deedAllocation;
  check(rows.length>0 && Array.isArray(allocation) && allocation.length===rows.length &&
    r.funding.length===rows.length && new Set(r.funding.map(v=>v.coinId)).size===rows.length &&
    new Set(r.funding.map(v=>v.launcherId)).size===rows.length && new Set(r.funding.map(v=>v.inventoryCoinId)).size===rows.length &&
    list([t('MINT_TEST_ONLY'),a(r.collectionCommitment),a(r.editionHash),n(BigInt(rows.length))]).hash===r.billHash);
  const structure=pair(a('0x7faa3253bfddd1e0decb0906b2dc6247bbc4cf608f58345d173adb63e8b47c9f'),
    pair(a(m.launcherId),a('0xeff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9')));
  const launcherModule=parseClvm('0x'+SINGLETON_LAUNCHER_WITH_DID_PUZZLE_HEX.replace(/^0x/,''));
  // The known launcher module is the same one used by the native inventory.
  const launcherHash=curry(launcherModule,[structure]).hash;
  let shares=0n,usd=0n,par=0n;
  rows.forEach((raw,i)=>{
    const row=asList(raw,4),f=r.funding[i],deed=allocation[i];
    check(row.length===4 && hash(f.coinId) && hash(f.launcherId) && hash(f.inventoryCoinId) && safe(f.confirmedHeight) &&
      safe(f.coin.amount) && hash(f.coin.parent_coin_info) && hash(f.coin.puzzle_hash) &&
      coinId(f.coin.parent_coin_info,f.coin.puzzle_hash,f.coin.amount)===f.coinId && row[0].hash===a(f.coinId).hash &&
      coinId(f.coinId,launcherHash,1)===f.launcherId && safe(deed.sharePpm));
    const share=asUint(row[1]),base=asUint(row[2]),xch=asUint(row[3]);
    check(share===BigInt(deed.sharePpm) && share>0n && share<=1_000_000n && base>0n && xch>0n &&
      xch===uint64(deed.parValueMojos) && base*1_000_000n===uint64(d.offering.targetRaiseMinor)*share);
    shares+=share;usd+=base;par+=xch;
  });
  check(shares===1_000_000n && usd===uint64(d.offering.targetRaiseMinor) && par===uint64(d.offering.parValueMojos));
  return r;
}
