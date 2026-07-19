import { Injectable, inject } from '@angular/core';
import { TypedDataEncoder, sha256, toUtf8Bytes } from 'ethers';

import { environment } from '../../environments/environment';
import { Eip712TypedData } from './solslot-api.service';
import { CollectionWorkspace } from './collection-api.service';
import { EvmWalletService } from './evm-wallet.service';
import {
  PROPERTY_AMENDMENT_SCHEMA,
  PropertyAmendmentV1,
  PropertyDossierV1,
} from './property-metadata/property-dossier';
import {
  PropertyMetadataService,
  canonicalizeJcs,
} from './property-metadata/property-metadata.service';

const AMENDMENT_TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
  ],
  SolslotPropertyAmendment: [
    { name: 'collectionId', type: 'string' },
    { name: 'previousRoot', type: 'bytes32' },
    { name: 'newRoot', type: 'bytes32' },
    { name: 'reasonHash', type: 'bytes32' },
    { name: 'effectiveDate', type: 'string' },
    { name: 'changedFieldsHash', type: 'bytes32' },
  ],
};

@Injectable({ providedIn: 'root' })
export class PropertyAmendmentService {
  private readonly wallet = inject(EvmWalletService);
  private readonly metadata = inject(PropertyMetadataService);

  async sign(
    workspace: CollectionWorkspace,
    dossier: PropertyDossierV1,
    reason: string,
    effectiveDate: string,
    changedFields: string[],
  ): Promise<{ dossier: PropertyDossierV1; amendment: PropertyAmendmentV1 }> {
    if (workspace.ownerAuthType !== 'evm') {
      throw new Error('This UI currently requires an EVM-owned collection for owner amendments.');
    }
    if (!workspace.metadataRoot) throw new Error('The current metadata root is missing.');
    if (!reason.trim() || reason.trim().length < 8) {
      throw new Error('Amendment reason must contain at least eight characters.');
    }
    if (!effectiveDate) throw new Error('Effective date is required.');
    if (!changedFields.length) throw new Error('No operational fields changed.');
    const nextDossier = { ...dossier, revision: workspace.revision + 1 };
    const commitment = this.metadata.commit(nextDossier);
    const typedData = amendmentTypedData({
      collectionId: workspace.id,
      previousRoot: workspace.metadataRoot,
      newRoot: commitment.metadataRoot,
      reason: reason.trim(),
      effectiveDate,
      changedFields,
    });
    const address = this.wallet.address();
    if (!address) throw new Error('Connect the collection owner EVM wallet before signing.');
    if (address.toLowerCase() !== workspace.ownerSubject.toLowerCase()) {
      throw new Error('The connected wallet is not the collection owner.');
    }
    const signature = await this.wallet.signTypedData(typedData);
    const { EIP712Domain: _domain, ...types } = AMENDMENT_TYPES;
    const typedDataHash = TypedDataEncoder.hash(typedData.domain, types, typedData.message);
    return {
      dossier: nextDossier,
      amendment: {
        schemaVersion: PROPERTY_AMENDMENT_SCHEMA,
        collectionId: workspace.id,
        previousRoot: workspace.metadataRoot,
        newRoot: commitment.metadataRoot,
        reason: reason.trim(),
        effectiveDate,
        changedFields,
        signature: {
          scheme: 'eip712',
          signer: address,
          signature,
          chainId: String(environment.eip712ChainId),
          typedDataHash,
        },
      },
    };
  }
}

function amendmentTypedData(input: {
  collectionId: string;
  previousRoot: string;
  newRoot: string;
  reason: string;
  effectiveDate: string;
  changedFields: string[];
}): Eip712TypedData {
  return {
    types: AMENDMENT_TYPES,
    primaryType: 'SolslotPropertyAmendment',
    domain: {
      name: 'Solslot Property Metadata',
      version: '1',
      chainId: environment.eip712ChainId,
    },
    message: {
      collectionId: input.collectionId,
      previousRoot: input.previousRoot,
      newRoot: input.newRoot,
      reasonHash: sha256(toUtf8Bytes(input.reason)),
      effectiveDate: input.effectiveDate,
      changedFieldsHash: sha256(toUtf8Bytes(canonicalizeJcs(input.changedFields))),
    },
  };
}
