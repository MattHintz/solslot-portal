# zkPassport next bricks

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
- Target architecture is all on-chain + frontend: zkPassport verifier contract, Warp message delivery, Chia vault singleton spend, and Angular polling/signing. The normal user path should not depend on a Populis backend.
- Solslot references:
  - `research/solslot-omnichain`: EVM contract calls `IPortal.messageToll()` and `IPortal.sendMessage(bytes3 destinationChain, bytes32 destination, bytes32[] contents)` after collecting exact toll.
  - `research/solslot-samuel`: Chia-side drivers load CLVM hex, curry singleton puzzles, build `CoinSpend`s, aggregate signatures, and push bundles.

## Brick 9 — EVM zkPassport attestation contract surface

Repo: contract workspace to be chosen or created.

Output:

- Minimal Solidity verifier/adapter contract that accepts zkPassport `compressed-evm` proof output.
- Bind the proof to the Populis vault using zkPassport `custom_data = vault:<launcher_id>` or equivalent canonical binding.
- Use the zkPassport Solidity verifier as the only proof-verification dependency; after verification, all downstream state moves by EVM events/Warp messages and frontend polling.
- Emit a canonical event containing only commitment data needed by the Chia side:
  - vault launcher id
  - scoped nullifier
  - nullifier type
  - service scope hash
  - service subscope hash
  - proof timestamp
  - attestation root or leaf commitment
  - bridge policy/message fields needed by Warp
- No passport plaintext, no disclosed PII.

Acceptance:

- Contract tests prove malformed binding, wrong subscope, stale proof timestamp, and invalid verifier result are rejected.
- Event fields round-trip into the existing portal attestation helper known-answer shape.

Commit style:

```text
zkpassport: add EVM attestation contract scaffold
```

## Brick 10 — Warp / bridge message adapter

Repo: contract workspace and/or protocol docs.

Output:

- Wire the EVM attestation event into the Warp/omnichain send path.
- Define the canonical Chia bridge message payload matching `computeAttestationBridgeMessage`.
- Publish the bridge policy hash as a deploy-time constant the portal can pin.
- Follow the Solslot `IPortal` pattern:
  - read `messageToll()`
  - require the user transaction to pay the exact toll
  - call `sendMessage("xch", destinationPuzzle, contents)`
  - set `destinationPuzzle` to the Chia-side bridge/message puzzle that will create the coin announcement consumed by the vault `'z'` spend.
- Encode `contents` as fixed `bytes32[]` commitments, not raw proof/PII:
  - vault launcher id
  - new identity attestation root
  - bridge policy hash
  - scoped nullifier or attestation leaf hash
  - proof timestamp / policy version if needed for replay checks

Acceptance:

- Tests prove the emitted bridge message equals the Chia-side helper output for fixed vectors.
- Portal can read verifier/bridge constants without a privileged backend.

Commit style:

```text
zkpassport: wire warp attestation message
```

## Brick 11 — Portal EVM attestation client and poller

Repo: `populis_portal`.

Output:

- User starts zkPassport verification from the vault dashboard.
- Portal requests/launches the EVM proof flow and watches the attestation transaction/event.
- Portal derives the attestation leaf/root and bridge message automatically from event data.
- Replace manual preview inputs with read-only status fields and polling states.

Acceptance:

- Component/service tests cover pending, found, malformed event, and timeout states.
- No user-pasted verifier/bridge fields remain in the normal flow.

Commit style:

```text
zkpassport: poll EVM attestation output
```

## Brick 12 — Portal chain-derived vault enrollment spend package

Repo: `populis_portal`.

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

Repo: `populis_portal`.

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

Repo: `populis_portal`.

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

Repo: `populis_portal`.

Output:

- When a deed purchase/accept-offer flow exists, automatically inject stored proof params from the confirmed enrollment.
- Do not repeat zkPassport verification for every deed purchase.

Acceptance:

- Tests prove accept-offer builder receives `identityAttestRoot`, `attestationLeafHash`, and `attestationProof` from storage.
- Missing proof blocks purchase with a clear enrollment-required state.

Commit style:

```text
vault: include confirmed zkPassport proof in offers
```
