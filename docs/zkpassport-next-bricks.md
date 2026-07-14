# zkPassport next bricks

For the broader core-up admin/governance/member path from mint proposals to offer generation and gated acceptance, see `core-up-offer-acceptance-roadmap.md`.

This scaffold continues from the committed portal checkpoints:

- Brick 7: `1854f6f vault: wire zkPassport enrollment preview`
- Brick 8: `58115fb zkpassport: persist vault proof params`

## Non-negotiable UX and trust model

- Users must not paste vault internals, bridge coin ids, puzzle hashes, or CLVM fields.
- After zkPassport attestation on EVM, the portal should poll or derive all bridge/vault inputs automatically.
- Normal enrollment must not use a backend autosigner or admin oracle.
- The portal builds the Chia vault spend client-side, Samuel-style, with WASM/CLVM helpers.
- The user explicitly signs/authorizes the vault enrollment spend with the vault auth method they chose: EVM, Chia BLS, or passkey.
- The portal pushes the signed bundle directly to coinset only after user confirmation.
- Target architecture is all on-chain + frontend: zkPassport verifier event contract, frontend-relayed Chia validator/member bridge coin, Chia vault singleton spend, and Angular polling/signing. The normal user path should not depend on a Solslot backend.
- Solslot references:
  - `research/solslot-omnichain`: useful Warp/omnichain reference only; not required by the primary frontend-relayed validator bridge.
  - `research/solslot-samuel`: Chia-side drivers load CLVM hex, curry singleton puzzles, build `CoinSpend`s, aggregate signatures, and push bundles.
- Bridge trust root is not browser state. The frontend may poll, assemble, relay, and submit, but the Chia bridge puzzle must enforce validator/member quorum signatures cryptographically.

## Audit release gates

- F-13: Vault identity enrollment must require current-owner authorization before the identity path ships.
- F-14: Passkey vault launch must reject compressed secp256r1 owner keys before passkey vaults ship.
- F-03 and F-11 remain portal launch-path blockers for mint draft canonicalisation and Chia amount precision.
- F-12, F-15, F-16, F-17, and F-18 remain API/admin launch-path blockers outside this bridge brick.

## Brick 9 — EVM zkPassport attestation contract surface

Repo: contract workspace to be chosen or created.

Output:

- Minimal Solidity verifier/adapter contract that accepts zkPassport `compressed-evm` proof output.
- Bind the proof to the Solslot vault using zkPassport `custom_data = vault:<launcher_id>` or equivalent canonical binding.
- Use the zkPassport Solidity verifier as the only proof-verification dependency; after verification, all downstream state moves by EVM events, frontend polling, Chia validator/member signatures, and Chia spends.
- Emit a canonical event containing only commitment data needed by the Chia side:
  - vault launcher id
  - scoped nullifier
  - nullifier type
  - service scope hash
  - service subscope hash
  - proof timestamp
  - attestation root or leaf commitment
  - bridge policy/message fields validators must sign
- No passport plaintext, no disclosed PII.

Acceptance:

- Contract tests prove malformed binding, wrong subscope, stale proof timestamp, and invalid verifier result are rejected.
- Event fields round-trip into the existing portal attestation helper known-answer shape.

Commit style:

```text
zkpassport: add EVM attestation contract scaffold
```

## Brick 10 — Chia validator/member bridge puzzle

Repo: `solslot_protocol`.

Output:

- Add a Chia bridge/message coin puzzle that curies validator/member keys, threshold, and bridge policy hash.
- The puzzle verifies enough signatures over the canonical zkPassport attestation message derived from the EVM event.
- If quorum verifies, the puzzle emits the coin announcement consumed by the vault `'z'` spend.
- Encode the signed message as fixed commitments, not raw proof/PII:
  - vault launcher id
  - new identity attestation root
  - bridge policy hash
  - scoped nullifier or attestation leaf hash
  - proof timestamp / policy version if needed for replay checks
- Keep Warp as an optional future compatibility adapter, not the primary normal enrollment path.

Acceptance:

- CLVM tests prove insufficient signatures fail and threshold signatures emit the exact announcement asserted by the vault.
- Python driver fixture can build the bridge spend and vault `'z'` spend in one bundle for fixed vectors.

Commit style:

```text
zkpassport: add validator bridge message puzzle
```

## Brick 11 — Portal EVM attestation client and poller

Repo: `solslot_portal`.

Output:

- User starts zkPassport verification from the vault dashboard.
- Portal requests/launches the EVM proof flow and watches the attestation transaction/event.
- Portal derives the attestation leaf/root and bridge message automatically from event data.
- Portal requests validator/member signatures for the canonical message and builds the bridge coin spend in WASM.
- Replace manual preview inputs with read-only status fields and polling states.

Acceptance:

- Component/service tests cover pending, found, malformed event, and timeout states.
- Tests cover insufficient validator signatures, threshold-ready bridge spend package, and no backend signing dependency.
- No user-pasted verifier/bridge fields remain in the normal flow.

Commit style:

```text
zkpassport: poll EVM attestation output
```

## Brick 12 — Portal chain-derived vault enrollment spend package

Repo: `solslot_portal`.

Output:

- Use coinset and singleton lineage to derive current vault coin, amount, parent lineage, current inner puzzle hash, and puzzle reveal.
- Use WASM/CLVM to build the full vault `'z'` singleton spend from derived chain state and bridge data.
- Keep the package unsigned until user authorization.

Acceptance:

- WASM fixture tests pin the serialized inner solution and full singleton solution against Python vectors.
- No manual CLVM/puzzle-hash input fields.

Commit style:

```text
vault: build enrollment spend in wasm
```

## Brick 13 — Signer adapters for vault auth methods

Repo: `solslot_portal`.

Output:

- EVM/secp256k1: sign the vault enrollment authorization with the existing EIP-712 style path or the required enrollment-specific typed data.
- Chia BLS: request wallet signing for the generated coin spend bundle.
- Passkey/secp256r1: request WebAuthn/passkey assertion for the enrollment message.
- Normalize all paths into one signed spend bundle shape.

Acceptance:

- Unit tests cover signer selection for `evm`, `chia_bls`, and `passkey` sessions.
- No hidden autosigning; every path has an explicit user confirmation boundary.

Commit style:

```text
vault: add enrollment signer adapters
```

## Brick 14 — Direct commit and confirmation polling

Repo: `solslot_portal`.

Output:

- Push the signed enrollment spend bundle directly through coinset.
- Poll the vault singleton lineage until the identity attestation root updates.
- Persist accept-offer proof params only after the on-chain enrollment is confirmed.

Acceptance:

- Tests cover push failure, mempool accepted, confirmation, and timeout states.
- Dashboard clearly distinguishes attested-on-EVM, bridge-ready, signed, pushed, and confirmed states.

Commit style:

```text
vault: commit zkPassport enrollment spend
```

## Brick 15 — Accept-offer proof autowiring

Repo: `solslot_portal`.

Output:

- When a deed purchase/accept-offer flow exists, automatically inject stored proof params from the confirmed enrollment.
- Do not repeat zkPassport verification for every deed purchase.
- Current planning handoff: `ZkPassportAcceptOfferProofService` is the required portal boundary for future accept-offer spend builders. New purchase code must call `withProofParams` or `buildWithProof` instead of reading `ZkPassportProofStoreService` directly.

Acceptance:

- Tests prove accept-offer builder receives `identityAttestRoot`, `attestationLeafHash`, and `attestationProof` from storage.
- Missing proof blocks purchase with a clear enrollment-required state.

Commit style:

```text
vault: include confirmed zkPassport proof in offers
```

## Brick 16 — Accept-offer builder integration plan

Repo: `solslot_portal`.

Output:

- Add the first portal-side deed purchase / accept-offer builder seam, even if the visible marketplace UI remains minimal.
- Inject `ZkPassportAcceptOfferProofService` into that builder/controller and require confirmed proof params before any spend package is built.
- Pass exactly these proof fields into the accept-offer spend inputs:
  - `identityAttestRoot`
  - `attestationLeafHash`
  - `attestationProof`
- Surface `ZkPassportEnrollmentRequiredError` as an enrollment-required UI state with a route/action back to the vault zkPassport enrollment card.
- Keep KYC reuse strict: do not launch zkPassport verification from purchase flow unless the user explicitly follows the enrollment-required action.

Acceptance:

- Unit tests prove the accept-offer builder is not called when the proof is missing.
- Unit tests prove the builder receives the stored proof fields through `ZkPassportAcceptOfferProofService`.
- Component tests prove the purchase flow shows a clear enrollment-required state rather than a generic error.
- No purchase code imports `ZkPassportProofStoreService` directly.

Commit style:

```text
vault: wire zkPassport proof into accept-offer builder
```
