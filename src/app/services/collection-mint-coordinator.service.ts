import { Injectable, inject } from '@angular/core';

import { environment } from '../../environments/environment';
import { MintProposalResponse } from './admin-api.service';
import { CollectionDeed, CollectionWorkspace } from './collection-api.service';
import { Eip712LeafHashService } from './eip712-leaf-hash.service';
import { EvmWalletService } from './evm-wallet.service';
import {
  MintProposalV2PublishRunnerService,
  PublishMintArgs,
  PublishRunResult,
} from './mint-proposal-v2/mint-proposal-v2-publish-runner.service';
import { PublishMintArgsAssemblerService } from './mint-proposal-v2/publish-mint-args-assembler.service';
import { PropertyRegistryRegistrationMaterialService } from './mint-proposal-v2/property-registry-registration-material.service';
import { PropertyDossierV1 } from './property-metadata/property-dossier';
import { PropertyMetadataService } from './property-metadata/property-metadata.service';

export interface CollectionMintPreview {
  proposalId: string;
  deedId: string;
  metadataRoot: string;
  metadataAnchorId: string | null;
  canonicalByteSize: number;
  estimatedConsensusCost: number;
  network: 'testnet11' | 'mainnet';
  walletSubject: string;
  governanceThreshold: string;
  args: PublishMintArgs;
}

@Injectable({ providedIn: 'root' })
export class CollectionMintCoordinatorService {
  private readonly assembler = inject(PublishMintArgsAssemblerService);
  private readonly registry = inject(PropertyRegistryRegistrationMaterialService);
  private readonly runner = inject(MintProposalV2PublishRunnerService);
  private readonly metadata = inject(PropertyMetadataService);
  private readonly evmWallet = inject(EvmWalletService);
  private readonly eip712Leaf = inject(Eip712LeafHashService);

  async deriveOwnerMemberHash(): Promise<{ hash: string; address: string; pubkey: string }> {
    const { pubkey, address } = await this.evmWallet.recoverFirstAdminPubkey();
    return {
      hash: this.eip712Leaf.compute(pubkey, environment.chiaNetwork).leaf_hash,
      address,
      pubkey,
    };
  }

  async prepare(
    workspace: CollectionWorkspace,
    deed: CollectionDeed,
    ownerMemberHash: string,
  ): Promise<CollectionMintPreview> {
    if (!['SEALED', 'PUBLISHED'].includes(workspace.state)) {
      throw new Error('The collection must be sealed before proposal preparation.');
    }
    if (!workspace.metadataRoot) throw new Error('The sealed metadata root is missing.');
    if (deed.proposalId) throw new Error(`${deed.deedId} already has proposal ${deed.proposalId}.`);

    const dossier = workspace.dossier as PropertyDossierV1;
    const commitment = this.metadata.commit(dossier);
    if (commitment.metadataRoot.toLowerCase() !== workspace.metadataRoot.toLowerCase()) {
      throw new Error('Browser canonicalization does not reproduce the sealed metadata root.');
    }
    const offering = dossier.offering;
    if (!offering) throw new Error('The sealed offering terms are missing.');
    const draft = proposalDraft(workspace, deed, dossier);
    const assembled = this.assembler.assemble({
      draft,
      ownerMemberHash,
      protocolContext: {
        protocolDidSingletonStructHex: environment.solslotProtocol.protocolDidSingletonStructHex,
        protocolDidPuzhash: environment.solslotProtocol.protocolDidPuzhash,
        protocolDidInnerPuzhash: environment.solslotProtocol.protocolDidInnerPuzhash,
        governanceSingletonStructHex: environment.solslotProtocol.governanceSingletonStructHex,
        p2PoolModHash: environment.solslotProtocol.p2PoolModHash,
        p2VaultModHash: environment.solslotProtocol.p2VaultModHash,
        propertyRegistryPuzzleHash: environment.solslotProtocol.propertyRegistryCurrentPuzzleHash,
      },
    });
    if (assembled.kind !== 'ok') {
      throw new Error(
        assembled.kind === 'missing-protocol-context'
          ? `Protocol context is missing: ${assembled.missing.join(', ')}`
          : `Proposal input is invalid: ${assembled.reason}`,
      );
    }
    const registration = await this.registry.build({
      registryLauncherId: environment.solslotProtocol.propertyRegistryLauncherId,
      registryGovPubkey: environment.solslotProtocol.propertyRegistryGovPubkey,
      propertyIdCanon: assembled.args.propertyIdCanon,
    });
    if (registration.kind !== 'ok') {
      throw new Error(`Could not build the property-registry co-spend: ${registration.error}`);
    }
    const args: PublishMintArgs = {
      ...assembled.args,
      propertyRegistryPuzzleHash: registration.propertyRegistryPuzzleHash,
      propertyRegistryCoinSpend: registration.spend,
      metadataRoot: workspace.metadataRoot,
      ...(workspace.metadataAnchorId
        ? { metadataAnchorId: workspace.metadataAnchorId }
        : { canonicalMetadataJson: commitment.canonicalJson }),
    };
    return {
      proposalId: draft.id,
      deedId: deed.deedId,
      metadataRoot: workspace.metadataRoot,
      metadataAnchorId: workspace.metadataAnchorId,
      canonicalByteSize: commitment.byteSize,
      estimatedConsensusCost: this.metadata.estimateConsensusCost(commitment.byteSize),
      network: environment.chiaNetwork,
      walletSubject: workspace.ownerSubject,
      governanceThreshold: offering.governanceQuorum,
      args,
    };
  }

  publish(preview: CollectionMintPreview): Promise<PublishRunResult> {
    return this.runner.publishMint(preview.args);
  }
}

function proposalDraft(
  workspace: CollectionWorkspace,
  deed: CollectionDeed,
  dossier: PropertyDossierV1,
): MintProposalResponse {
  const offering = dossier.offering;
  const now = Math.floor(Date.now() / 1000);
  return {
    id: stableProposalId(workspace.id, deed.deedId),
    owner_pubkey: workspace.ownerSubject,
    state: 'DRAFT',
    par_value: safeInteger(deed.parValueMojos, 'par value'),
    asset_class: offering.assetClass,
    property_id: deed.deedId,
    collection_id: workspace.id,
    share_ppm: deed.sharePpm,
    jurisdiction: offering.jurisdiction,
    royalty_puzhash: offering.royaltyPuzhash,
    royalty_bps: safeInteger(offering.royaltyBps, 'royalty basis points', true),
    quorum_required: safeInteger(offering.governanceQuorum, 'governance quorum'),
    computed: {
      smart_deed_inner_puzhash: null,
      eve_inner_puzhash: null,
      deed_full_puzhash: null,
      proposal_hash: null,
    },
    on_chain: {
      proposal_tracker_coin_id: null,
      proposal_singleton_launcher_id: null,
      sgt_lock_coin_id: null,
      deed_launcher_id: null,
      property_registry_coin_id: null,
      property_registry_puzzle_hash: null,
      published_bundle_id: null,
      executed_bundle_id: null,
    },
    vote_tally: 0,
    deadline: null,
    timestamps: { created_at: now, published_at: null, executed_at: null, minted_at: null },
    off_chain_metadata: { source: 'collection-workspace', metadataRoot: workspace.metadataRoot },
  };
}

function stableProposalId(collectionId: string, deedId: string): string {
  const value = `collection:${collectionId}:${deedId}`.replace(/[^A-Za-z0-9._:-]/g, '-');
  return value.slice(0, 256);
}

function safeInteger(value: string, label: string, allowZero = false): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || (!allowZero && parsed === 0)) {
    throw new Error(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} JavaScript-safe integer.`);
  }
  return parsed;
}
