import { AdminOperationApproval } from '../admin-operation-approval.service';
import { CollectionWorkspace } from '../collection-api.service';

export function sealFixture(): { item: AdminOperationApproval; workspace: CollectionWorkspace } {
  const generation = `0x${'22'.repeat(32)}`;
  return {
    item: {
      operationId: 'seal-review', payloadHash: `0x${'33'.repeat(32)}`, operation: 'collection.seal',
      status: 'pending', revision: 13, network: 'testnet11', createdBy: 'owner', createdAt: 1,
      expiresAt: Math.floor(Date.now() / 1000) + 600, signatures: [{adminIndex: 0, signerAddress: 'owner'}],
      requestBinding: {method: 'POST', path: '/admin/collections/TEST-EXAMPLE/seal', ifMatch: '"13"', query: [], body: {}},
    } as unknown as AdminOperationApproval,
    workspace: {
      id: 'TEST-EXAMPLE', revision: 13, state: 'REVIEW', ownerSubject: 'owner', generationId: generation,
      draftHash: `0x${'44'.repeat(32)}`, metadataRoot: null, assets: [], deeds: [], comments: [],
      reviews: [], metadataVersions: [], anchorEvidence: [], readiness: {ready: true, metadataRoot: `0x${'55'.repeat(32)}`, issues: []},
      dossier: {
        schemaVersion: 'solslot.testnet-property-dossier.v1', collectionId: 'TEST-EXAMPLE', revision: 13,
        title: 'Example House — Testnet Edition', purpose: 'TEST_ONLY', network: 'testnet11', generationId: generation,
        projectTeam: {sponsor: {legalName: 'Example sponsor (proposed)'}, builderStatus: 'not-appointed', builderIsSponsor: false},
        property: {address: {line1: '1 Example Lane', region: 'TN', country: 'US'}},
        offering: {targetRaiseMinor: '7500000', currency: 'USD', royaltyBps: '100', jurisdiction: 'US-TN'},
        fsreTerms: {structure: 'FSRE', returnBasis: 'MARKET_VALUE', participationBps: 1500, outsideTermMonths: 14, projectedMonthsMin: 10, projectedMonthsMax: 12},
        valuation: {marketValueMinor: '155000000', currency: 'USD'}, valuationBasis: 'TO_BE_BUILT', valuationEvidence: 'USER_CONFIRMED',
        unknownFields: [{path: '/capital/debtBalanceMinor', status: 'UNKNOWN', reason: 'Payoff evidence not supplied'}],
        deedAllocation: Array.from({length: 25}, (_, i) => ({deedId: `deed-${i}`, sharePpm: 40000, parValueMojos: '1'})),
        privateDocuments: [{assetId: 'private-document', title: 'PRIVATE TITLE MUST NOT APPEAR', category: 'legal'}],
        media: [], documents: [], disclosures: [], risks: [], history: [], dataSources: [], diligence: [],
      },
    } as unknown as CollectionWorkspace,
  };
}
