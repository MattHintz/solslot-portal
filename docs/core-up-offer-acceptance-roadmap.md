# Core-up roadmap: mint to gated zkPassport acceptance

Status: planning scaffold for the next atomic bricks.

## Operating rule

Plan and implement from the core outward:

1. Protocol invariant or driver vector.
2. Portal domain model or service seam.
3. Focused unit tests.
4. Minimal integration surface.
5. UI/UX state wiring.
6. Full suite gate.
7. Small commit.

Avoid large cross-layer bricks. Every brick should leave the tree shippable, tested, and easy to revert.

## Notation

### Roles

| Code | Role | Meaning |
|---|---|---|
| `OP` | Admin operator | Creates mint drafts, publishes approved operations, monitors lifecycle. |
| `GC` | Governance committee member | Reviews mint proposals and signs/votes according to governance rules. |
| `EM` | Existing member | Has a vault and may already have confirmed zkPassport enrollment. |
| `NM` | New member | Needs onboarding, vault creation, zkPassport enrollment, and gated acceptance. |
| `VA` | Vault owner auth | The selected vault auth method: EVM, Chia BLS, or passkey. |

### Artifacts

| Code | Artifact | Meaning |
|---|---|---|
| `MP` | Mint proposal | Admin-created proposal record and canonical proposal hash. |
| `GB` | Governance bill | On-chain executable payload governed by committee/PGT rules. |
| `DL` | Deed launcher id | Singleton launcher id for the minted deed. |
| `OF` | Offer artifact | The spend/offer data that lets an eligible vault accept a deed. |
| `VAULT` | Member vault singleton | Chia singleton controlled by the member. |
| `ZP` | zkPassport proof params | `identityAttestRoot`, `attestationLeafHash`, `attestationProof`. |
| `AOSP` | Accept-offer spend package | Unsigned portal-built package for gated deed acceptance. |
| `SB` | Signed spend bundle | User-authorized spend bundle ready for push. |

### State notation

Use `Actor:STATE` in docs, specs, and UI state names when possible.

Admin mint lifecycle:

```text
OP:DRAFT -> OP:PUBLISHED -> GC:VOTING -> GC:PASSED | GC:FAILED -> OP:EXECUTED -> OP:MINTED -> OP:OFFER_READY
```

Member onboarding and purchase lifecycle:

```text
NM:UNCONNECTED -> NM:NO_VAULT -> NM:VAULT_READY -> NM:ZK_REQUIRED -> NM:ZK_PENDING -> EM:ZK_CONFIRMED -> EM:ELIGIBLE -> EM:ACCEPT_AUTH_REQUIRED -> EM:ACCEPT_SUBMITTED -> EM:ACCEPT_CONFIRMED
```

Offer eligibility notation:

```text
eligible(vault, offer) = hasVault && hasConfirmedZkPassportProof && offerAcceptableByVault && chainStateFresh
```

### Test gate notation

| Gate | Meaning |
|---|---|
| `[UNIT]` | Pure unit test; no browser, no network. Required for every service brick. |
| `[VEC]` | Known-answer vector against protocol/Python/CLVM serialization. Required for spend builders. |
| `[INT]` | Angular component or service integration test with mocked boundaries. Required for UX state bricks. |
| `[NEG]` | Negative-path test: missing proof, stale state, rejection, timeout, malformed data. Required for trust boundaries. |
| `[NO-BACKEND]` | Proves normal member path does not depend on backend autosigning or hidden admin authority. |
| `[NO-DIRECT-STORE]` | Proves purchase/acceptance code does not import `ZkPassportProofStoreService` directly. |

## Brick template

Each brick should include:

```text
Brick N — Short name
Repo:
Layer:
Goal:
Outputs:
Tests:
Negative tests:
Open questions resolved:
Stop condition:
Commit style:
```

## Cross-layer invariants

- `ZP` is persisted only after on-chain vault enrollment confirmation.
- Purchase/acceptance code must call `ZkPassportAcceptOfferProofService`, not `ZkPassportProofStoreService`.
- The portal must never repeat zkPassport verification for every deed purchase.
- Missing `ZP` must produce an enrollment-required state, not a generic failure.
- The normal member path must not use backend autosigning.
- User authorization remains explicit before any spend bundle is pushed.
- CLVM remains the authoritative gate for offer acceptance; portal checks are UX and safety preflight.
- Admin/governance API surfaces may assist operators, but member acceptance should remain frontend/on-chain wherever possible.

## Proposed atomic bricks

### Brick 16 — Offer domain model and state notation

Repo: `populis_portal`.

Layer: portal domain only.

Goal: define the minimal TypeScript model for offer discovery, offer detail, eligibility, and purchase UI state without implementing spend construction.

Outputs:

- Add `OfferSummary`, `OfferDetail`, `OfferTerms`, `OfferArtifact`, and `OfferEligibilityState` types.
- Add pure helpers for eligibility classification:
  - missing vault
  - zkPassport enrollment required
  - eligible
  - stale chain state
  - unavailable offer
- Use the state notation from this document in enum/string names.

Tests:

- `[UNIT]` classifies each eligibility state.
- `[NEG]` missing vault and missing `ZP` are distinct.
- `[NO-BACKEND]` helpers require no API or wallet dependency.

Commit style:

```text
offers: add member offer domain model
```

### Brick 17 — Protocol accept-offer vector audit

Repo: `populis_protocol`.

Layer: protocol/driver.

Goal: identify the canonical Python driver/vector shape the portal must mirror for `SPEND_ACCEPT_OFFER`.

Outputs:

- Pin the required accept-offer inputs and solution shape.
- Produce or refresh known-answer vectors for:
  - valid proof
  - missing proof
  - wrong attestation root
  - wrong attestation leaf
  - stale or wrong vault state if applicable

Tests:

- `[VEC]` serialized solution matches expected tree hash / bytes.
- `[NEG]` missing or wrong proof fails.
- `[NEG]` proof against wrong root fails.

Commit style:

```text
vault: pin accept-offer proof vectors
```

### Brick 18 — Portal accept-offer vector fixtures

Repo: `populis_portal`.

Layer: portal fixture/test harness.

Goal: import the protocol accept-offer vectors into portal tests before building UI.

Outputs:

- Add vector fixture file under `src/app/services` or `src/app/testing`.
- Add pure normalization helpers if needed for CLVM/hex consistency.
- No runtime purchase flow yet.

Tests:

- `[UNIT]` fixture parses and validates required fields.
- `[VEC]` vector field names and hex normalization match protocol output.
- `[NEG]` malformed fixture data fails loudly.

Commit style:

```text
offers: add accept-offer vector fixtures
```

### Brick 19 — Gated accept-offer builder seam

Repo: `populis_portal`.

Layer: portal service.

Goal: add the first builder/controller seam that wraps future spend construction with `ZkPassportAcceptOfferProofService`.

Outputs:

- Add `VaultAcceptOfferBuildService` or equivalent.
- Inject `ZkPassportAcceptOfferProofService`.
- Require `ZP` before invoking the lower-level builder.
- Return an unsigned `AOSP` placeholder or typed builder result depending on vector readiness.

Tests:

- `[UNIT]` builder receives `identityAttestRoot`, `attestationLeafHash`, and `attestationProof`.
- `[NEG]` missing proof throws `ZkPassportEnrollmentRequiredError`.
- `[NEG]` lower-level builder is not called when proof is missing.
- `[NO-DIRECT-STORE]` service does not import `ZkPassportProofStoreService`.

Commit style:

```text
vault: wire zkPassport proof into accept-offer builder
```

### Brick 20 — Accept-offer spend construction from vectors

Repo: `populis_portal`.

Layer: portal WASM/CLVM service.

Goal: build the unsigned accept-offer spend package from chain-derived vault state, offer artifact, and injected `ZP`.

Outputs:

- Build `AOSP` using WASM/CLVM helpers.
- Validate current vault coin and lineage before constructing the spend.
- Keep package unsigned until explicit user authorization.

Tests:

- `[UNIT]` rejects missing vault coin, mismatched launcher, or malformed offer artifact.
- `[VEC]` serialized spend/solution matches protocol vector.
- `[NEG]` wrong proof fields fail before signing when detectable.
- `[NO-BACKEND]` no backend signer dependency.

Commit style:

```text
offers: build gated accept-offer spend package
```

### Brick 21 — Accept-offer signer and commit service

Repo: `populis_portal`.

Layer: portal service.

Goal: authorize and push the accept-offer bundle with explicit user approval, then poll for confirmation.

Outputs:

- Add accept-offer authorization service for `VA` methods that are supported by vault accept-offer spend.
- Add commit service that pushes through coinset.
- Poll expected vault/deed/pool state transition after submission.

Tests:

- `[UNIT]` explicit signing boundary is required.
- `[UNIT]` push failure surfaces clear error.
- `[UNIT]` timeout and unexpected state advancement are handled.
- `[INT]` confirmation result updates typed status.

Commit style:

```text
offers: authorize and commit gated acceptance
```

### Brick 22 — Member offer detail UX shell

Repo: `populis_portal`.

Layer: UI/UX.

Goal: add minimal offer detail/member purchase page using mocked or static offer input, wired to eligibility states.

Outputs:

- Add `/offers/:id` or equivalent route.
- Show offer terms, vault state, zkPassport state, and primary action.
- Missing vault links to vault creation.
- Missing `ZP` links to vault zkPassport enrollment.
- Eligible state enables accept flow.

Tests:

- `[INT]` missing vault state renders correct call to action.
- `[INT]` missing `ZP` renders enrollment-required state.
- `[INT]` eligible state enables accept button.
- `[NEG]` generic errors do not hide enrollment-required state.

Commit style:

```text
offers: add member acceptance state shell
```

### Brick 23 — Offer source abstraction

Repo: `populis_portal`.

Layer: portal data service.

Goal: abstract offer discovery so UI can later switch from static/mock to API or chain scanning.

Outputs:

- Add `OfferSourceService` interface and first implementation.
- Normalize offer artifact fields into `OfferDetail`.
- Keep acceptance builder independent of discovery source.

Tests:

- `[UNIT]` maps source data to domain model.
- `[NEG]` malformed offer artifact becomes unavailable state.
- `[INT]` offer page can render source service result.

Commit style:

```text
offers: add offer source abstraction
```

### Brick 24 — Admin mint to offer planning seam

Repo: `populis_portal` and/or `populis_api`.

Layer: admin/governance planning and API contract.

Goal: specify how `OP:MINTED` becomes `OP:OFFER_READY`.

Outputs:

- Define the canonical fields persisted or emitted after mint execution:
  - deed launcher id
  - offer artifact id/hash
  - price/terms
  - accepted asset
  - expiration if applicable
  - eligibility/gating policy
- Identify whether offer generation is protocol-driver, admin API, or portal-driven.

Tests:

- `[UNIT]` API/domain schema validates required offer fields.
- `[NEG]` minted proposal without deed launcher id cannot become offer-ready.

Commit style:

```text
admin: define minted deed offer artifact
```

### Brick 25 — Governance committee UX state alignment

Repo: `populis_portal`.

Layer: governance UI/UX.

Goal: align committee review states with the mint-to-offer lifecycle used by member purchase flow.

Outputs:

- Committee page shows where a proposal sits in `OP/GC` notation.
- Mint detail shows whether approval leads to deed mint only or deed plus offer artifact.
- Add read-only diagnostics for proposal hash and expected launcher/offer outputs where available.

Tests:

- `[INT]` committee sees proposal status and required action.
- `[INT]` passed/executed/minted states render distinct next steps.
- `[NEG]` failed proposal cannot show offer-ready action.

Commit style:

```text
governance: align committee mint lifecycle states
```

### Brick 26 — New member guided path

Repo: `populis_portal`.

Layer: UI/UX orchestration.

Goal: connect `NM` onboarding from offer interest through vault creation, zkPassport enrollment, and return to offer acceptance.

Outputs:

- Preserve intended offer route while user creates vault/enrolls.
- Show checklist for wallet, vault, zkPassport, eligibility, accept.
- Return user to offer after confirmation.

Tests:

- `[INT]` no vault routes user to create-vault path with return target.
- `[INT]` no `ZP` routes user to vault enrollment with return target.
- `[INT]` confirmed enrollment returns to offer eligibility.

Commit style:

```text
members: guide onboarding into gated offer acceptance
```

## Questions to resolve before implementation bricks

### Protocol and vectors

- What is the canonical Python driver function for accept-offer construction?
- Which accept-offer fields are fixed by the offer and which are chosen by the accepting vault?
- Does accept-offer require one vault spend, one pool spend, one deed spend, or a larger bundle?
- Which state transition confirms acceptance: vault coin advance, deed ownership change, pool state change, or all three?
- Is proof freshness checked only by root membership, or also by timestamp/policy version?

### Offer generation

- Who creates `OF`: admin operator, governance execution, protocol driver, or a later marketplace service?
- Does `OP:MINTED` always imply an offer should be generated?
- Are offers single-buyer, reusable, expiring, cancellable, or price-adjustable?
- Is offer discovery chain-scanned, API-backed, static artifact based, or Chia offer-file based?

### Admin and governance

- Which admin flows are considered complete enough to depend on for offer generation?
- Does committee approval approve only minting, or also sale terms?
- Should committee members see final offer terms before voting?
- Is there a separate governance action for offer generation after deed mint?

### Member UX

- Should a new member start from an offer page or a vault onboarding page?
- Should offers be visible before eligibility checks are complete?
- Should zkPassport enrollment happen only on the vault page, or can offer UX embed a guided enrollment card?
- Should advanced diagnostics expose attestation root/leaf, or hide them unless debugging?

## Immediate recommendation

Next brick should be Brick 16: portal offer domain model and eligibility state notation.

Reason:

- It is core-up but portal-local.
- It creates vocabulary for admin, governance, and member UI without committing to an offer source.
- It enables many small `[UNIT]` tests before CLVM builder work.
- It gives future UI work stable state names.
