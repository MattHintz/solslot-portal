import {environment} from '../../environments/environment';
import {deploymentGeneration} from './deployment-generation';
import {computeAddress} from 'ethers';

/** Release pins are installed from independently confirmed genesis evidence.
 * No wallet, API response, old artifact or shared URL may populate these pins.
 * Fresh native input evidence and full local spend checks remain mandatory.
 */
export function installGenerationBuildBindings(): void {
  const config=environment.solslotProtocol, pins=config.generationBuildBindings;
  config.generationBindingsVerified=false;
  config.adminAuthorityV3LauncherId='';
  config.adminAuthorityV3IdentityLauncherIds=[];
  const hash=(v:unknown):v is string=>typeof v==='string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v);
  const generation=deploymentGeneration();
  const bindings=config.generationHolderBindings;
  const keys=['bridgePolicyHash','governanceLauncherId','ledgerLauncherId','poolLauncherId','reserveOwner','tailHash'];
  if(!generation || pins.schemaVersion!==1 || pins.generationId!==generation || !hash(pins.readAnchorHash) ||
      !/^[0-9a-f]{40}$/.test(config.adminPortalSourceSha) || !hash(pins.authorityLauncherId) ||
      !Number.isSafeInteger(pins.evmChainId) || pins.evmChainId<=0 || pins.evmChainId!==environment.eip712ChainId ||
      pins.dailyPublicKeys.length!==3 || !pins.dailyPublicKeys.every(v=>/^0x(?:02|03)[0-9a-f]{64}$/.test(v)) ||
      new Set(pins.dailyPublicKeys).size!==3 ||
      pins.identityLauncherIds.length!==3 || !pins.identityLauncherIds.every(hash) ||
      JSON.stringify(Object.keys(bindings).sort())!==JSON.stringify(keys) || !Object.values(bindings).every(hash) ||
      new Set([pins.authorityLauncherId,...pins.identityLauncherIds,bindings.ledgerLauncherId,
        bindings.governanceLauncherId,bindings.poolLauncherId]).size!==7){
    throw new Error('This generation release is missing its confirmed launch bindings. Saved actions remain closed.');
  }
  pins.dailyPublicKeys.forEach(key=>computeAddress(key));
  // These fields are used by generation consent reconstruction. Legacy
  // artifactVerified/coordinate guards stay closed in a generation release.
  config.adminAuthorityV3LauncherId=pins.authorityLauncherId;
  config.adminAuthorityV3IdentityLauncherIds=[...pins.identityLauncherIds];
  config.generationBindingsVerified=true;
}
