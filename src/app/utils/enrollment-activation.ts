/** Content validation only. Callers must authenticate the pinned genesis artifact
 * before applying the selected identity-chain configuration. */
import { concat, sha256, toUtf8Bytes } from 'ethers';
import { canonicalIntBytes } from './chia-hash';
import type { SolslotPublicArtifact } from '../services/solslot-api.service';
export interface EnrollmentActivation {
  schema: 'solslot.enrollment-activation.v1'; environment: 'staging-alpha' | 'production-alpha';
  network: 'testnet11'; evmChainId: 8453 | 84532; deploymentId: string; sourceShas: Record<string,string>;
  releaseIdentity: string; emitter: string; issuer: string; issuerKeyRef: string; issuerIdentityClientId: string;
  permitVersion: 1; adapterVersion: 1; validatorMessageVersion: 1; bridgeModuleHash: string;
  contextHash: string; bridgePolicyHash: string; permitLifetimeSeconds: number; reviewEvidenceSha256: string;
}
export const BRIDGE_MODULE_HASH = '0x2c8b1ddeb939570bbd9cd2e79ffe3787eb42ab28a3d661fae95354ec8a5eee38';
function requireThat(value: unknown,message: string): asserts value { if (!value) throw new Error(message); }
function exactKeys(value: unknown,fields: string[],label: string): void {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(','),`${label} is incomplete or unsupported.`);
}
export function exactHex(value: unknown,length: number,label: string): asserts value is string {
  requireThat(typeof value === 'string' && new RegExp(`^0x[0-9a-f]{${length*2}}$`).test(value) && value !== '0x'+'00'.repeat(length),`${label} must be canonical nonzero hex.`);
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(canonicalJson).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson((value as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
}
export const hashJson=(value:unknown)=>sha256(toUtf8Bytes(canonicalJson(value)));
const atom=(value:string|Uint8Array)=>sha256(concat(['0x01',value]));
const pair=(a:string,b:string)=>sha256(concat(['0x02',a,b]));
const listHashes=(values:string[])=>values.reduceRight((acc,v)=>pair(v,acc),atom('0x'));
const list=(values:(string|Uint8Array)[])=>listHashes(values.map(atom));
const uint=(n:number)=>canonicalIntBytes(BigInt(n));
export const activationContext=(a:EnrollmentActivation)=>list([toUtf8Bytes('solslot-enrollment-context-v1'),toUtf8Bytes(a.environment),
  toUtf8Bytes(a.network),uint(a.evmChainId),a.emitter,a.issuer,a.deploymentId,a.releaseIdentity]);
export function permitBridgePolicy(validators:string[],context:string):string {
  requireThat(Array.isArray(validators) && validators.length===3 && new Set(validators).size===3,'Three distinct validators are required.');
  validators.forEach(v=>exactHex(v,48,'Validator'));exactHex(context,32,'Context');
  let args=atom('0x01');
  for(const h of [list(validators),atom(uint(2)),atom(context)].reverse()) args=listHashes([atom('0x04'),pair(atom('0x01'),h),args]);
  return listHashes([atom('0x02'),pair(atom('0x01'),BRIDGE_MODULE_HASH),args]);
}
export function artifactActivation(artifact:SolslotPublicArtifact,expectedDomain?:string):EnrollmentActivation|null {
  const plan=artifact.genesisPlan;
  const selected=Object.hasOwn(artifact,'enrollmentActivation') || !!plan && Object.hasOwn(plan,'enrollmentActivation') || artifact.evmChainId!==11155111;
  if (!selected) return null;
  const a=artifact.enrollmentActivation;
  exactKeys(a,['schema','environment','network','evmChainId','deploymentId','sourceShas','releaseIdentity','emitter','issuer','issuerKeyRef',
    'issuerIdentityClientId','permitVersion','adapterVersion','validatorMessageVersion','bridgeModuleHash','contextHash','bridgePolicyHash','permitLifetimeSeconds','reviewEvidenceSha256'],'Selected identity deployment');
  requireThat(a,'Selected identity deployment is missing.');
  requireThat(artifact.schemaVersion===4 && artifact.sourceManifestVersion===4 && artifact.protocolVersion==='solslot-v2-rc23' &&
    artifact.evmChainId===84532 && a.schema==='solslot.enrollment-activation.v1' && a.network==='testnet11' && [8453,84532].includes(a.evmChainId) &&
    ['staging-alpha','production-alpha'].includes(a.environment),'Selected identity deployment is not an isolated alpha deployment.');
  const domain=a.environment==='staging-alpha'?'staging.solslot.com':'solslot.com';
  if (expectedDomain !== undefined) requireThat(domain===expectedDomain,'Identity deployment belongs to another host.');
  exactKeys(a.sourceShas,['protocol','evm','omnichain','api','legacyBackend','keyOfSolomon','samuel','customerWeb','adminPortal'],'Release sources');
  requireThat(Object.values(a.sourceShas).every(v=>/^[0-9a-f]{40}$/.test(v) && v!=='0'.repeat(40)) &&
    canonicalJson(a.sourceShas)===canonicalJson(artifact.sourceShas) && a.releaseIdentity===hashJson({schema:'solslot.enrollment-release.v1',sourceShas:a.sourceShas}),'Identity deployment release differs.');
  for(const k of ['deploymentId','releaseIdentity','contextHash','bridgePolicyHash'] as const)exactHex(a[k],32,k);
  exactHex(a.emitter,20,'Emitter');exactHex(a.issuer,20,'Issuer');
  requireThat(a.deploymentId===artifact.ceremony.ceremonyId && a.emitter===artifact.evmAddresses?.attestationEmitter &&
    canonicalJson(a)===canonicalJson(plan?.['enrollmentActivation']) &&
    a.permitVersion===1 && a.adapterVersion===1 && a.validatorMessageVersion===1 &&
    Number.isSafeInteger(a.permitLifetimeSeconds) && a.permitLifetimeSeconds>=1 && a.permitLifetimeSeconds<=3600 &&
    /^[0-9a-f]{64}$/.test(a.reviewEvidenceSha256) && a.reviewEvidenceSha256!=='0'.repeat(64) &&
    /^https:\/\/[a-z][a-z0-9-]{1,22}[a-z0-9]\.vault\.azure\.net\/keys\/[a-zA-Z0-9-]{1,127}\/[0-9a-f]{32}$/.test(a.issuerKeyRef) &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(a.issuerIdentityClientId) && a.issuerIdentityClientId!=='00000000-0000-0000-0000-000000000000' &&
    a.bridgeModuleHash===BRIDGE_MODULE_HASH && a.contextHash===activationContext(a) &&
    a.bridgePolicyHash===permitBridgePolicy(artifact.validatorSet.pubkeys,a.contextHash) &&
    a.bridgePolicyHash===artifact.bridgePolicy.policyHash && a.bridgePolicyHash===artifact.puzzleHashes['bridgePolicy'],
    'Identity deployment context, review or bridge policy differs.');
  for(const name of ['forwarder','verifierAdapter','attestationEmitter'])exactHex(artifact.evmAddresses?.[name],20,name);
  return a;
}
