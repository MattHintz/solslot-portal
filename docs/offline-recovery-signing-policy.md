# Offline recovery signing policy

The restore drill reconstructs its BLS digest locally from the exact EIP-712
schema, ceremony, slot, recovery-key commitment, revision, nonce and expiry.
Before either key signs, the recovery service also reconstructs the complete
canonical API payload and checks its challenge hash using the unlocked public
key. Address strings retain their validated API casing in the JSON hash. The
challenge ID is a separate random server handle; it is shape-checked and retained
for result association, not derived from the payload hash. Public checksums do
not establish provider authenticity or authorize arbitrary messages.

Standalone LOST authorization reconstructs its complete intent hash and BLS
digest again at the signer boundary. The service signs a private snapshot, so
changes to the caller's object while awaiting the guardian signature cannot
replace the later BLS message. The raw digest method is internal. Guardian
ACCEPT/VETO retains the existing restricted EIP-712 validation.

Message-only Chia PREPARE recovery packages are unsupported. Both import/export
validation and the shared BLS action signer reject them. The second-device page
does not ask for the phrase for this mode and does not claim that supplied pairs
were independently reconstructed. Importing another package clears the previous
review, approval checkbox, result and phrase before validating the replacement.
The case page explains that unsigned recovery-key Chia actions are unavailable
instead of offering an export button that fails. Already recorded signatures
remain visible; this does not assert that a complete recovery outcome is proven.

## Remaining integration requirement

This containment blocks honest Chia PREPARE authorizations too. Full lost-wallet
recovery through this browser cannot converge on both chains until deterministic
Chia spend reconstruction is implemented. Existing standalone LOST-intent
authorization is a different message and cannot substitute for those coin-bound
messages. The current handoff contains no spend, puzzle reveal, solution,
authenticated current authority/identity state or verified artifact context.
Re-enabling it requires sufficient independently authenticated state, complete
local transition/puzzle reconstruction, expected inputs/outputs and fees, and
verification of every emitted signature condition with Testnet11 coin/network
binding. Extra provider-selected hashes alone are insufficient.

The coordinator/Safe deployment trust gap is tracked separately in
BROWSER-RELAY-CALLDATA-003. This patch does not establish live deployment
authenticity, complete recovery, on-chain outcome, real-device behavior or launch
approval. Tests use public synthetic API-derived fixtures and mock key calls;
they never use an enrolled recovery phrase or submit a transaction.
