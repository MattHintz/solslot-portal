/** Fixed-effects review of a new-generation SGT custody authorization.
 * Bindings must come from the verified frozen generation artifact, and both
 * input records must be refreshed independently before wallet dispatch.
 * This signs only the vault's `g` branch; the immutable CAT/ledger kernels
 * require the exact committed SGT transition in the same transaction.
 */
import { computeAddress, getBytes, hexlify, sha256 } from 'ethers';
import { coinId } from './chia-hash';
import { deploymentGeneration } from './deployment-generation';
import { asList, atom, ClvmData, joinBytes, list, pair, parseClvm, uintAtom, uncurry } from './strict-clvm';

import { GENERATION_CUSTODY_MODULE_HASH } from './generation-vault-module';
export const GENERATION_VAULT_MODULE = GENERATION_CUSTODY_MODULE_HASH;
export const GENERATION_SGT_MODULE = '0xa5be3ebb8efad8c257cf57f5bd7270fdfb5588f15c93619c7a56858d36f30068';
export const GENERATION_SGT_OWNER = '0xb4581c25ba000f6531d65ef5ec66814bdcf89f163776b03a45314f68bbe0edc7';
const SINGLETON = '0x7faa3253bfddd1e0decb0906b2dc6247bbc4cf608f58345d173adb63e8b47c9f';
const LAUNCHER = '0xeff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9';
const CAT = '0x37bef360ee858133b69d595a906dc45d01af50379dad515eb9518abb7c1d2a7a';

export interface GenerationCoin {
  coin: {parentCoinInfo: string; puzzleHash: string; amount: number};
  confirmedHeight: number; spentHeight: number;
}
export interface GenerationCoinSpend {
  coin: GenerationCoin['coin']; puzzleReveal: string; solution: string;
}
export interface GenerationSgtContext {
  generationId: string; network: 'testnet11';
  bindings: {ledgerLauncherId: string; governanceLauncherId: string; reserveOwner: string; tailHash: string;
    poolLauncherId: string; bridgePolicyHash: string};
  owner: {authType: 1 | 3; publicKey: string; address: string};
  vault: {launcherId: string; identityRoot: string; current: GenerationCoin; parentSpend: GenerationCoinSpend};
  holding: {current: GenerationCoin;
    // Independently reconstructed current governance closure root. A prior
    // whole stake can vote again without an unlock/transfer that would make
    // the replacement coin ineligible in the already-open snapshot.
    priorLock?:{proposalId:string;closedRoot:string;closedProof:string[]}};
  // Selected by the user before the prepare response is received. Whole-coin
  // vote selection is explicit; a transfer can include an explicit change row.
  selection: {action: 'LOCK'; proposalId: string; snapshotRoot: string; eligibleSupply: number;
    snapshotProof: Array<[string,number,number]>; votingClosesAt: number | null} |
    {action: 'TRANSFER'; destinations: Array<{vaultLauncherId: string; amount: number}>};
}
export interface GenerationSgtRequest {
  generationId: string; action: 'LOCK' | 'TRANSFER'; expiresAt: number;
  vaultCoinId: string; sgtCoinId: string;
  outputs: Array<{kind: 1 | 2; owner: string; amount: number; lockId: string | null}>;
  vaultCoinSpend?: GenerationCoinSpend | null; typedData?: any;
}

const check = (value: unknown, why: string): void => { if (!value) throw new Error('SGT review failed: ' + why); };
const hash = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0{64}$/.test(v);
const n = (v: number) => { check(Number.isSafeInteger(v) && v >= 0,'unsigned amount'); return atom(uintAtom(BigInt(v))); };
const a = (v: string) => atom(getBytes(v));
const t = (v: string) => atom(new TextEncoder().encode(v));
const empty = () => atom(new Uint8Array());
const hp = (l: string,r: string) => sha256(joinBytes([Uint8Array.of(2),getBytes(l),getBytes(r)]));
const hl = (values: string[]) => values.reduceRight((tail,head)=>hp(head,tail),empty().hash);
function curryHash(module: string,args: string[]): string {
  let env=n(1).hash;
  for(let i=args.length-1;i>=0;i--)env=hl([n(4).hash,hp(n(1).hash,args[i]),env]);
  return hl([n(2).hash,hp(n(1).hash,module),env]);
}
function structure(launcher: string): ClvmData { check(hash(launcher),'singleton launcher'); return pair(a(SINGLETON),pair(a(launcher),a(LAUNCHER))); }
function ownerHash(generation: string,launcher: string): string {
  return curryHash(GENERATION_SGT_OWNER,[a(generation).hash,structure(launcher).hash]);
}
function holdingPuzzle(c: GenerationSgtContext,owner: string): string {
  const b=c.bindings;
  const bindings=list([a(c.generationId),structure(b.ledgerLauncherId),structure(b.governanceLauncherId),a(b.reserveOwner),a(CAT),a(b.tailHash)]);
  const old=c.holding.priorLock;
  const inner=curryHash(GENERATION_SGT_MODULE,[a(GENERATION_SGT_MODULE).hash,bindings.hash,n(old?2:1).hash,a(owner).hash,
    old?a(old.proposalId).hash:empty().hash]);
  return curryHash(CAT,[a(CAT).hash,a(b.tailHash).hash,inner]);
}
function confirmed(input: GenerationCoin): string {
  check(hash(input.coin.parentCoinInfo) && hash(input.coin.puzzleHash) && Number.isSafeInteger(input.coin.amount) && input.coin.amount>0 &&
    Number.isSafeInteger(input.confirmedHeight) && input.confirmedHeight>0 && input.spentHeight===0,'confirmed unspent input');
  return coinId(input.coin.parentCoinInfo,input.coin.puzzleHash,input.coin.amount);
}
function canonical(value: any): string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function snapshotGenerationReview<T>(value: T): T {
  // No getters or mutable class objects may cross the review boundary.
  let nodes=0,characters=0;
  const copy=(v:any,depth:number):any=>{
    check(depth<=32 && ++nodes<=10000,'review size and nesting bound');
    if(typeof v==='string'){characters+=v.length;check(characters<=1_000_000,'review text bound');return v;}
    if(v===null || typeof v==='boolean')return v;
    if(typeof v==='number'){check(Number.isSafeInteger(v),'integer review value');return v;}
    check(v && typeof v==='object' && (Array.isArray(v) || Object.getPrototypeOf(v)===Object.prototype),'plain review data');
    const entries=Object.getOwnPropertyDescriptors(v);
    check(Object.keys(entries).length<=1024 && Object.values(entries).every(d=>'value' in d),'review data descriptors');
    check(Object.getOwnPropertySymbols(v).length===0,'review symbol keys');
    if(Array.isArray(v)){
      check(entries['length'].value<=1023 && Object.keys(entries).length===entries['length'].value+1 &&
        Object.keys(entries).every(k=>k==='length'|| /^(0|[1-9][0-9]*)$/.test(k) && Number(k)<entries['length'].value),'dense review array');
      return Array.from({length:entries['length'].value},(_,i)=>copy(entries[String(i)].value,depth+1));
    }
    return Object.fromEntries(Object.entries(entries).map(([k,d])=>[k,copy(d.value,depth+1)]));
  };
  return copy(value,0);
}

function verifySnapshot(c: GenerationSgtContext,id: string,owner: string): void {
  const s=c.selection;
  if(s.action!=='LOCK')return;
  check(hash(s.proposalId) && hash(s.snapshotRoot) && Number.isSafeInteger(s.eligibleSupply) &&
    s.eligibleSupply>0 && s.eligibleSupply<=1_000_000 && s.snapshotProof.length===256,'opening snapshot');
  const old=c.holding.priorLock;
  if(old){
    check(hash(old.proposalId) && old.proposalId!==s.proposalId && hash(old.closedRoot) &&
      Array.isArray(old.closedProof) && old.closedProof.length===256 && old.closedProof.every(hash),'prior closed proposal proof');
    let root=sha256(joinBytes([Uint8Array.of(1),getBytes(old.proposalId)]));
    const priorKey=BigInt(old.proposalId);
    for(let i=0;i<256;i++)root=((priorKey>>BigInt(i))&1n)?hp(old.closedProof[i],root):hp(root,old.closedProof[i]);
    check(root===old.closedRoot,'authenticated prior proposal closure');
  }
  let node: [string,number,number]=[list([t('SGT_HOLDING_V1'),a(id),
    list([a(c.holding.current.coin.puzzleHash),n(c.holding.current.coin.amount),n(old?2:1),a(owner),old?a(old.proposalId):empty()])]).hash,
    c.holding.current.coin.amount,c.holding.current.coin.amount];
  const key=BigInt(id);
  for(let i=0;i<256;i++){
    const sibling=s.snapshotProof[i];
    check(Array.isArray(sibling) && sibling.length===3 && hash(sibling[0]) && Number.isSafeInteger(sibling[1]) && Number.isSafeInteger(sibling[2]) &&
      sibling[1]>=0 && sibling[1]<=sibling[2] && sibling[2]<=1_000_000,'snapshot branch');
    const children=((key>>BigInt(i))&1n)?[sibling,node]:[node,sibling];
    node=[list([t('SGT_NODE_V1'),...children.map(x=>list([a(x[0]),n(x[1]),n(x[2])]))]).hash,node[1]+sibling[1],node[2]+sibling[2]];
    check(node[1]<=node[2] && node[2]<=1_000_000,'snapshot supply conservation');
  }
  check(node[0]===s.snapshotRoot && node[1]===s.eligibleSupply && node[2]===1_000_000,'authenticated opening supply');
}

export function inspectGenerationSgt(raw: GenerationSgtRequest, source: GenerationSgtContext, nowSeconds=Math.floor(Date.now()/1000)) {
  const r=snapshotGenerationReview(raw),c=snapshotGenerationReview(source), gen=deploymentGeneration();
  check(gen && gen===r.generationId && gen===c.generationId && c.network==='testnet11','frozen deployment generation');
  const {bridgePolicyHash,...authorities}=c.bindings;
  check(Object.values(authorities).every(hash) && /^0x[0-9a-f]{64}$/.test(bridgePolicyHash),'frozen protocol bindings');
  const bls=c.owner.authType===1;
  check((bls && /^0x[0-9a-f]{96}$/.test(c.owner.publicKey) && !/^0x0{96}$/.test(c.owner.publicKey) && c.owner.address===c.owner.publicKey) ||
    (c.owner.authType===3 && /^0x0[23][0-9a-f]{64}$/.test(c.owner.publicKey) &&
      computeAddress(c.owner.publicKey).toLowerCase()===c.owner.address),'connected owner key');
  const vaultId=confirmed(c.vault.current),sgtId=confirmed(c.holding.current),owner=ownerHash(c.generationId,c.vault.launcherId);
  check(!c.holding.priorLock || c.selection.action==='LOCK' && hash(c.holding.priorLock.proposalId),'closed stake requires an explicit vote lock');
  check(c.vault.current.coin.amount===1 && c.holding.current.coin.amount<=1_000_000 &&
    c.holding.current.coin.puzzleHash===holdingPuzzle(c,owner),'vault and owned holder CAT');
  const key=a(c.owner.publicKey),members=a(key.hash),mine=structure(c.vault.launcherId);
  check(hash(c.vault.identityRoot),'identity root commitment'); // Empty identity is valid for SGT.
  const innerHash=curryHash(GENERATION_VAULT_MODULE,[mine.hash,key.hash,n(c.owner.authType).hash,members.hash,a(c.vault.identityRoot).hash,
    a(c.bindings.bridgePolicyHash).hash,a(SINGLETON).hash,a(c.bindings.poolLauncherId).hash,a(LAUNCHER).hash]);
  check(c.vault.current.coin.puzzleHash===curryHash(SINGLETON,[mine.hash,innerHash]),'unchanged canonical custody');
  check(r.vaultCoinId===vaultId && r.sgtCoinId===sgtId && r.action===c.selection.action &&
    Number.isSafeInteger(r.expiresAt) && r.expiresAt>nowSeconds && r.expiresAt<=nowSeconds+86400,'exact action, inputs and expiry');
  verifySnapshot(c,sgtId,owner);
  const outputs=c.selection.action==='LOCK' ? [{kind:2 as const,owner,amount:c.holding.current.coin.amount,lockId:c.selection.proposalId}]
    : c.selection.destinations.map(d=>({kind:1 as const,owner:ownerHash(c.generationId,d.vaultLauncherId),amount:d.amount,lockId:null}));
  check(outputs.length>0 && outputs.length<=16 && outputs.every(o=>Number.isSafeInteger(o.amount) && o.amount>0) &&
    outputs.reduce((total,o)=>total+o.amount,0)===c.holding.current.coin.amount && canonical(outputs)===canonical(r.outputs),'exact conserved destinations');
  if(c.selection.action==='LOCK' && c.selection.votingClosesAt!==null)
    check(Number.isSafeInteger(c.selection.votingClosesAt) && r.expiresAt<=c.selection.votingClosesAt,'fixed vote deadline');
  const descriptors=list(outputs.map(o=>list([n(o.kind),a(o.owner),o.lockId?a(o.lockId):empty(),n(o.amount)])));
  const digest=list([t('SGT_TRANSITION_V1'),a(c.generationId),a(sgtId),t(r.action),descriptors]).hash;
  const authorization=list([t('SGT_VAULT_AUTH_V1'),a(c.generationId),a(vaultId),a(sgtId),a(digest),n(r.expiresAt)]).hash;
  const typedData={types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'}],
    SolslotVaultSpend:[{name:'spend_case',type:'bytes32'},{name:'deed_launcher_id',type:'bytes32'},{name:'vault_coin_id',type:'bytes32'}]},
    primaryType:'SolslotVaultSpend',domain:{name:'Solslot Vault',version:'2',chainId:11155111},
    message:{spend_case:'0x67'+'00'.repeat(31),deed_launcher_id:authorization,vault_coin_id:vaultId}};
  if(bls){
    const spend=r.vaultCoinSpend;
    check(r.typedData==null && spend && Object.keys(spend).sort().join(',')==='coin,puzzleReveal,solution' &&
      canonical(spend.coin)===canonical(c.vault.current.coin),'exact BLS signing input');
    const full=parseClvm(spend!.puzzleReveal),outer=uncurry(full);
    check(full.hash===c.vault.current.coin.puzzleHash && outer.module.hash===SINGLETON && outer.args.length===2 &&
      outer.args[0].hash===mine.hash && outer.args[1].hash===innerHash,'complete BLS puzzle');
    const parent=c.vault.parentSpend, parentId=coinId(parent.coin.parentCoinInfo,parent.coin.puzzleHash,parent.coin.amount);
    check(parentId===c.vault.current.coin.parentCoinInfo && parseClvm(parent.puzzleReveal).hash===parent.coin.puzzleHash,'confirmed parent reveal');
    let lineage:ClvmData;
    if(parentId===c.vault.launcherId){
      check(parent.coin.puzzleHash===LAUNCHER && parent.coin.amount===1,'custody launcher');
      lineage=list([a(parent.coin.parentCoinInfo),n(1)]);
    }else{
      const prior=uncurry(parseClvm(parent.puzzleReveal));
      check(prior.module.hash===SINGLETON && prior.args.length===2 && prior.args[0].hash===mine.hash && parent.coin.amount===1,'custody lineage');
      lineage=list([a(parent.coin.parentCoinInfo),a(prior.args[1].hash),n(1)]);
    }
    const fields=list([a(vaultId),a(innerHash),n(1),t('g'),list([a(c.generationId),a(sgtId),a(digest),n(r.expiresAt),empty()])]);
    check(parseClvm(spend!.solution).hash===list([lineage,n(1),fields]).hash,'exact BLS SGT authorization');
  }else check(r.vaultCoinSpend==null && canonical(r.typedData)===canonical(typedData),'exact EVM typed authorization');
  return Object.freeze({generationId:c.generationId,action:r.action,expiresAt:r.expiresAt,sgtCoinId:sgtId,vaultCoinId:vaultId,
    sgtAmount:c.holding.current.coin.amount,outputs,transitionDigest:digest,authorizationHash:authorization,
    vaultFeeMojos:0,successorCoinId:coinId(vaultId,c.vault.current.coin.puzzleHash,1),successorPuzzleHash:c.vault.current.coin.puzzleHash,
    innerHash,ownerAddress:c.owner.address,vaultTypedData:bls?null:typedData,signingCoinSpends:bls?[r.vaultCoinSpend!]:[]});
}
export type GenerationSgtIntent=ReturnType<typeof inspectGenerationSgt>;

/** Execute the exact BLS vault spend and reject any unexpected effect. */
export function executeGenerationSgtBls(raw:GenerationSgtRequest, context:GenerationSgtContext, sdk:Record<string,any>, nowSeconds?:number):GenerationSgtIntent {
  const intent=inspectGenerationSgt(raw,context,nowSeconds);
  check(context.owner.authType===1 && intent.signingCoinSpends.length===1,'BLS custody');
  const spend=intent.signingCoinSpends[0],clvm=new sdk['Clvm']();
  let puzzle:any,solution:any,output:any,value:any;
  try{
    puzzle=clvm.deserialize(getBytes(spend.puzzleReveal));solution=clvm.deserialize(getBytes(spend.solution));
    output=puzzle.run(solution,100000000n,true);value=output.value;
    check(typeof output.cost==='bigint' && output.cost>0n && output.cost<=100000000n,'native BLS cost');
    const actual=asList(parseClvm(hexlify(value.serialize())),32).map(row=>row.hash).sort();
    const expected=[list([n(50),a(context.owner.publicKey),a(intent.authorizationHash)]),list([n(70),a(intent.vaultCoinId)]),
      list([n(73),n(1)]),list([n(72),a(spend.coin.puzzleHash)]),
      list([n(51),a(intent.successorPuzzleHash),n(1),list([a(intent.innerHash)])]),list([n(85),n(intent.expiresAt)]),
      list([n(62),a(intent.authorizationHash)]),list([n(61),a(sha256(joinBytes([getBytes(intent.sgtCoinId),getBytes(intent.transitionDigest)])))]),
      list([n(71),a(spend.coin.parentCoinInfo)]),list([n(73),n(1)])].map(row=>row.hash).sort();
    check(canonical(actual)===canonical(expected),'exact signature, unchanged vault, zero fee, expiry and paired SGT transition');
    return intent;
  }finally{value?.free();output?.free();solution?.free();puzzle?.free();clvm.free();}
}
