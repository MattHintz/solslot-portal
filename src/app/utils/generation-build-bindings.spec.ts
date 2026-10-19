import {environment} from '../../environments/environment';
import {installGenerationBuildBindings} from './generation-build-bindings';
import {SolslotProtocolArtifactService} from '../services/solslot-protocol-artifact.service';
import {SolslotApiService} from '../services/solslot-api.service';
import {Wallet} from 'ethers';

describe('Confirmed generation build bindings',()=>{
  const config=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  const h=(n:number)=>'0x'+n.toString(16).padStart(64,'0');
  let before:typeof config;
  beforeEach(()=>{
    before=structuredClone(config);config.generationId=h(1);config.adminPortalSourceSha='a'.repeat(40);
    config.generationBuildBindings={schemaVersion:1,generationId:h(1),readAnchorHash:h(2),authorityLauncherId:h(3),identityLauncherIds:[h(4),h(5),h(6)],
      evmChainId:environment.eip712ChainId,dailyPublicKeys:[1,2,3].map(n=>new Wallet('0x'+n.toString(16).padStart(64,'0')).signingKey.compressedPublicKey)};
    config.generationHolderBindings={ledgerLauncherId:h(7),governanceLauncherId:h(8),poolLauncherId:h(9),reserveOwner:h(10),tailHash:h(11),bridgePolicyHash:h(12)};
  });
  afterEach(()=>{Object.assign(config,before);if(before.generationId===undefined)delete config.generationId;});
  it('installs exact generation consent pins without accepting a legacy artifact',async()=>{
    const api=jasmine.createSpyObj('api',['getSignedProtocolArtifact']);
    config.artifactVerified=true;
    const service=new SolslotProtocolArtifactService(api as SolslotApiService);
    await service.initialize();
    expect(config.generationBindingsVerified).toBeTrue();expect(config.artifactVerified).toBeFalse();
    expect(config.adminAuthorityV3LauncherId).toBe(h(3));
    expect(config.adminAuthorityV3IdentityLauncherIds).toEqual([h(4),h(5),h(6)]);
    expect(service.isReady).toBeFalse();expect(api.getSignedProtocolArtifact).not.toHaveBeenCalled();
  });
  it('fails closed for incomplete, foreign or duplicate release pins and clears former authority',()=>{
    const original=structuredClone(config);
    const changes:Array<()=>void>=[()=>config.generationBuildBindings.generationId=h(99),
      ()=>config.generationBuildBindings.readAnchorHash='',()=>config.adminPortalSourceSha='',
      ()=>config.generationBuildBindings.identityLauncherIds=[h(4),h(4),h(6)],
      ()=>config.generationBuildBindings.authorityLauncherId=h(7),
      ()=>config.generationBuildBindings.dailyPublicKeys[1]=config.generationBuildBindings.dailyPublicKeys[0],
      ()=>config.generationBuildBindings.evmChainId+=1,
      ()=>config.generationHolderBindings.tailHash='0x'+'0'.repeat(64)];
    for(const mutate of changes){Object.assign(config,structuredClone(original));installGenerationBuildBindings();mutate();
      expect(()=>installGenerationBuildBindings()).toThrowError(/missing its confirmed launch bindings/);
      expect(config.generationBindingsVerified).toBeFalse();expect(config.adminAuthorityV3LauncherId).toBe('');
      expect(config.adminAuthorityV3IdentityLauncherIds).toEqual([]);}
  });
  it('does not fall back to old artifact authority when the generation configuration is incomplete',async()=>{
    config.generationBuildBindings.readAnchorHash='';config.artifactVerified=true;
    const api=jasmine.createSpyObj('api',['getSignedProtocolArtifact']);
    const service=new SolslotProtocolArtifactService(api as SolslotApiService);await service.initialize();
    expect(config.generationBindingsVerified).toBeFalse();expect(config.artifactVerified).toBeFalse();
    expect(service.failure).toContain('missing its confirmed launch bindings');
    expect(api.getSignedProtocolArtifact).not.toHaveBeenCalled();
  });
});
