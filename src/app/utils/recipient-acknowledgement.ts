import { Eip712TypedData } from '../services/solslot-api.service';
import { RecipientConsentReview } from '../services/generation-recipients.service';
import { deploymentGeneration } from './deployment-generation';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}

/** Reconstruct from the previously displayed review, never a fresh prompt. */
export function validateRecipientAcknowledgement(data: Eip712TypedData, review: RecipientConsentReview,
                                                  connectedWallet: string): Eip712TypedData {
  const generation=deploymentGeneration(),r=review.recipient;
  const hash=(s: unknown)=>typeof s==='string' && /^0x[0-9a-f]{64}$/.test(s) && !/^0x0+$/.test(s);
  if (!generation || review.generationId!==generation || !hash(review.preparationManifest) ||
      ![1,2,3].includes(r.administratorSlot) || r.amount!==10000 || !r.confirmed ||
      !/^0x[0-9a-f]{40}$/.test(r.wallet) || r.wallet!==connectedWallet.toLowerCase() ||
      !hash(r.identityAuthority) || !hash(r.recipientVault) || !hash(r.recipientPuzzle) ||
      r.identityAuthority===r.recipientVault) throw new Error('Review the confirmed recipient for your enrolled wallet again.');
  const expected: Eip712TypedData={
    types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'salt',type:'bytes32'}],
      SolslotSGTRecipient:[{name:'preparationManifest',type:'bytes32'},{name:'network',type:'string'},
        {name:'administratorSlot',type:'uint8'},{name:'identityAuthority',type:'bytes32'},
        {name:'recipientVault',type:'bytes32'},{name:'recipientPuzzle',type:'bytes32'},{name:'amount',type:'uint64'}]},
    primaryType:'SolslotSGTRecipient',domain:{name:'Solslot SGT recipient',version:'1',salt:generation},
    message:{preparationManifest:review.preparationManifest,network:'testnet11',administratorSlot:r.administratorSlot,
      identityAuthority:r.identityAuthority,recipientVault:r.recipientVault,recipientPuzzle:r.recipientPuzzle,amount:10000}};
  if(canonical(data)!==canonical(expected))throw new Error('The wallet request differs from the recipient you reviewed.');
  return expected;
}
