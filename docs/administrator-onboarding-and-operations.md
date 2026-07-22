# Solslot administrator onboarding and operations

## Purpose and current scope

This runbook defines the work, authority boundaries, and onboarding requirements for the two Solslot administrators being added to the V2 testnet operation.

An administrator is an **operator of chain-authorized protocol work**, not an unrestricted backend owner. An administrator prepares and submits authorized protocol actions; Chia singleton state, the current admin-authority MIPS quorum, governance/committee rules, feature gates, and independent signers remain the enforcement mechanisms.

This document covers the current V2 implementation. It deliberately distinguishes live capabilities from planned work so no administrator assumes that a portal page, API index, or draft record grants authority to mint, move funds, or bypass a required quorum.

## Role boundaries

| Role | Authority | Must not do |
| --- | --- | --- |
| Bootstrap operator | Runs the single-use V2 genesis ceremony before the bootstrap lock exists. | Use the ceremony token or cookie as ongoing admin authority. Reopen a finalized bootstrapper. |
| Administrator | Authenticates with an enrolled EVM wallet, prepares collections and mint work, verifies trust roots, manages approved operational actions, and participates in the admin-authority quorum. | Treat an API, browser state, JWT, environment allowlist, or candidate wallet as protocol authority. |
| Governance committee member | Reviews and signs/votes on governance proposals under committee rules. This can be the same human only if approved separation-of-duty policy allows it. | Treat an administrator login as committee authority. |
| Validator / KoS signer operator | Keeps private signing hosts healthy and performs the documented signer-host procedures. | Expose a seed, generic signing endpoint, or private signer service to the public Internet. |
| Auditor | Reviews public artifacts, coordinates, transaction evidence, and release identity. | Sign or approve operational writes unless separately enrolled in an authority role. |

## Authority model for two administrators

### Identity and login

- Each administrator needs a **separate hardware-backed EVM wallet** with a securely backed-up recovery process. Wallets must never be shared.
- The public EVM address and compressed secp256k1 public key must be added to the signed `admin_records_v2.json` roster and must match the live `admin_authority_v2` singleton commitments.
- Admin login uses a fresh EIP-712 `SolslotAdminLogin` signature. The browser/API must verify the signer against the current roster; the session is short-lived and membership is rechecked on protected requests.
- Store no wallet seed, private key, raw identity document, passport data, ceremony bearer token, or signer credential in the portal, API database, Git history, tickets, chat, or public ceremony artifacts.

### Adding the two new administrators

Treat each addition as a security-sensitive change with a written change record, independent review, and chain confirmation.

1. Collect the candidate's wallet address and compressed public key over an authenticated out-of-band channel. The candidate must prove wallet control by signing the onboarding challenge.
2. Compare the submitted identity with the intended person, and record the wallet fingerprint, date, approver, and recovery contact in the private operator register.
3. Read the live admin-authority singleton and verify the launcher ID, current coin, `authority_version`, MIPS root, existing roster prefix, and `pending_ops_hash` against the signed ceremony records.
4. Build the append-only roster update package for **exactly one** candidate. Verify locally that it preserves every existing record and `pending_ops_hash`, increments `authority_version` once, and recomputes the MIPS root using the required supermajority threshold.
5. Have the **current** admin MIPS quorum review and authorize the final Chia spend bundle. The candidate does not authorize their own addition; the API, committee, and bootstrap token also do not authorize it.
6. Broadcast only after the signed spend bundle, live singleton input, puzzle reveal, and quorum solution have been independently hash-verified. Wait for on-chain confirmation.
7. Regenerate/check the signed admin records and deploy them through the approved release path. Confirm the API starts cleanly and the portal/API independently reject the old roster state.
8. Have the new administrator perform a non-mutating login and trust-root check. Archive the transaction ID, before/after authority version, hashes, reviewer identities, and confirmation evidence.

### Two-admin availability warning

The documented initial transition from a single administrator creates a **2-of-2** authority. That improves protection against a unilateral action but means either unavailable or compromised wallet can block every quorum-requiring operation. Before enabling valuable writes, define the approved recovery, removal, and third-member plan; test it on Testnet11. Do not assume a bootstrap token, API operator, or committee vote can repair the roster.

### Current portal limitation

The `AddAdminSlotComponent` can build, export, and locally preflight the A.5 roster-update package, and its submit control is deliberately a **no-signing, no-broadcast** boundary (the submit button is hard-disabled and the export is marked `preview_only_roster_spend_signer_not_wired`). The component itself lists the MIPS puzzle reveal, quorum solution, live singleton lookup, wallet signing, and coinset push wiring as still missing for live submission.

Two stronger constraints apply in the **current build**, verified against `src/app/app.routes.ts`:

- The `add-admin-slot`, `roster-spend-package-review`, `recovery`, `launch-authority-v2`, and `launch-protocol-config` components exist as source files but are **not wired into the router**. An administrator cannot navigate to the roster-update screen in the deployed portal today; it must be routed before it is even usable for preview.
- `/admin` currently loads the collections desk, not a roster or mint dashboard.

A separately reviewed spend-builder/signer process is required to construct, collect required signatures for, and broadcast the final live Chia bundle. Do not present onboarding as a self-service portal action until the screen is routed, the signer path is implemented, and both are tested.

## Required access and working setup

Each administrator must have the following before receiving production-like authority:

- A dedicated EVM wallet, preferred hardware wallet, with verified address/public-key export and an offline recovery backup.
- Access to the approved Solslot portal origin and correct Testnet11 network configuration.
- Read-only access to release evidence, signed public artifact, admin records checksum, deployment/bootstrap manifests, protocol coordinates, and recovery anchor evidence.
- Access to the change-control channel and incident channel; use named individual accounts with MFA.
- Read access to chain explorer/Coinset state and the approved transaction/evidence archive.
- For infrastructure duties only: least-privilege access to the deployment workflow, production/staging diagnostics, and secret manager. Administrative portal authority does **not** imply SSH, GitHub environment-secret, database, firewall, validator-host, or KoS-signer access.
- A completed Testnet11 exercise: login, trust-root verification, draft/review workflow, rejected-signature test, logout/session-expiry check, and emergency contact drill.

## Division of work

Assign one primary and one verifier for every material action. Swap roles regularly; neither person should prepare, approve, and archive the same change alone.

| Work area | Primary administrator | Verifying administrator |
| --- | --- | --- |
| Daily protocol and release review | Checks chain state, release identity, write gates, API health, and signer health evidence. | Repeats critical checks and signs the operations log. |
| Collection and mint preparation | Creates/verifies property collection, canonical IDs, allocations, documents, terms, and hashes. | Checks provenance, duplicate IDs, allocation totals, document commitment, and readiness issues. |
| Mint proposal publication/execution | Prepares transaction inputs and required approval evidence. | Verifies live coordinates, proposal state, committee approval, mint gates, signer health, and final transaction preview. |
| Authority roster change | Prepares one candidate package and evidence. | Independently validates the full package and current quorum; current quorum signs. |
| Bridge-pool replenishment | Evaluates confirmed pool balance and prepares a top-up request. | Confirms that replenishment is necessary, uses current chain-bound authority, and checks the confirmed result. |
| Release/rollback | Dispatches only the canonical pipeline and records release ID. | Confirms immutable release metadata, public release endpoint, health/security checks, and rollback evidence. |
| Incident response | Opens incident, freezes relevant writes, preserves evidence, coordinates response. | Validates containment, communications, and safe restoration conditions. |

## Regular operating checklist

### Every operating day

1. Confirm the correct network, protocol version, signed artifact hash, admin-authority launcher, current authority version, and write-gate state before any mutation.
2. Verify the API release endpoint matches the frozen API and protocol commits; investigate any mismatch before using the desk.
3. Review chain state for the authority singleton, governance state, active vault/bridge-pool conditions, and pending operator work.
4. Check API health and release verification markers. For credential writes or minting, require current validator-fleet health evidence and matching artifact hashes.
5. Review failed, timed-out, replay-rejected, or unexpectedly duplicated actions. Preserve raw public transaction references and diagnostic timestamps.
6. Log every material operation: requester, preparer, verifier, purpose, chain/network, canonical hashes, transaction/bundle ID, result, and evidence location.

### Before any protocol write

1. Start a change record that states the business purpose, exact target state, rollback/containment plan, preparer, verifier, required signers, and expected on-chain outputs.
2. Re-read live chain state. Never reuse a stale singleton coin, proposal state, price, bridge coin, or transaction template.
3. Verify canonical coordinates only from the signed V2 ceremony bundle. A request parameter, local configuration override, or browser cache cannot replace pool, governance, treasury, registry, or bridge coordinates.
4. Confirm the relevant gates are enabled only when authorized. Mint actions require both `SOLSLOT_ALPHA_WRITES_ENABLED=true` and `SOLSLOT_MINTING_ENABLED=true`; leave them locked otherwise.
5. Use the narrowest action-specific authority. Admin authority does not replace committee approval, owner authorization, validator threshold signatures, or KoS MINT execution signing.
6. Review the exact transaction/spend package, signing domain, recipient chain, inputs, outputs, resulting launcher/coin IDs, fees, and state transition before signing.
7. Broadcast through the approved path, wait for authoritative chain confirmation, compare the actual result to the expected state, then archive evidence.

### Weekly

- Reconcile portal/API indexes with authoritative Chia singleton state; indexes and local drafts are workflow aids, not source of truth.
- Review admin roster membership, authority version, session/authentication failures, access inventory, and pending quorum changes.
- Review bridge-pool capacity, validator quorum availability, signer artifact/release consistency, and backup completion reports.
- Review all feature gates and ensure temporary test settings, development CORS, public docs, and insecure cookies are not present in staging/production.
- Verify the latest known-good release remains rollback eligible and its release identity/public checks are archived.
- Hold a short operations review covering changes, incidents, blocked work, and any separation-of-duty exceptions.

### Monthly or before a release/mint window

- Re-run the applicable full test, namespace, dependency, and exploit-regression gates from the frozen commits.
- Verify the release pipeline builds reproducibly, uses the exact protocol commit, and deploys only through the canonical workflow.
- Test administrator login, logout, membership revocation behavior, recovery-anchor verification, and a dry-run change approval.
- Exercise validator/KoS health checks without exposing private interfaces or credentials.
- Review backup restoration readiness for API and signer SQLite-WAL ledgers; do not restore an empty ledger as a shortcut.
- Rotate/revoke credentials when exposure, staff departure, policy, or evidence requires it. Never rotate private material casually during an active incident without preserving recovery evidence.

## Core administrator workflows

### Collections and minting

Administrators prepare the property/investor dossier and controlled proposal data. Required checks include:

- Canonical property and collection identifiers; duplicates are hard conflicts.
- Verified asset, share allocation, valuation/par value, jurisdiction, royalty destination/rate, terms, filing/security structure, and definitive document location.
- A canonical hash for the complete mutable document set before publication.
- Public URLs, transaction references, statuses, and hashes only; do not upload sensitive identity material or private keys.
- Current protocol coordinates, property-registry uniqueness evidence, governance approval, and enabled mint gates before execution.

The intended lifecycle is `DRAFT -> PUBLISHED -> VOTING -> PASSED/FAILED -> EXECUTED -> MINTED -> OFFER_READY`. In the current portal, some mint proposal functions are browser-local drafts and publish/execute/on-chain proposal wiring is incomplete. A draft is therefore **not** an on-chain proposal, does not reserve inventory, and must not be represented externally as approved or minted.

### Governance and committee interaction

- Administrators prepare complete, canonical inputs and provide reviewers with the proposal hash, expected state transition, and transaction evidence.
- Committee members provide governance votes/signatures through their separate authority. Admin login cannot create or substitute those votes.
- Execute only after approved on-chain state, current coordinates, required thresholds, and all feature gates are verified.
- If a proposal is rejected, expired, or ambiguous, stop. Do not amend or re-submit under the same assumptions without a new reviewed change record.

### Bridge-pool replenishment

- Public vault enrollment cannot create bridge coins or spend faucet funds.
- Replenishment is an explicit post-genesis action requiring a current chain-bound admin session and live confirmation of the active bridge policy/coins.
- Use the top-up endpoint only after both administrators have reviewed the confirmed need, amount, source, policy hash, expected coin results, and evidence plan.
- Reconcile the resulting coins on-chain. A server response alone is not completion.

### Trust-root verification and recovery

- The Trust Roots view actively resolves each ceremony coordinate on-chain via `ChiaSingletonReaderService`/Coinset, confirming the current coin ID, confirmed block index, and lineage depth against the signed artifact. It is a live verification surface, not a static informational read. Some inner-curry fields (for example quorum member lists) remain placeholders pending client-side uncurry support.
- Still cross-check pinned launcher IDs, current singleton state, state hashes, and artifact consistency with an independent explorer.
- Treat a missing, zero, malformed, retired, or mismatched coordinate as a fail-closed condition. Freeze affected writes and investigate.
- For bootstrap recovery, scan the chain-visible `SOLSLOT_BOOTSTRAP_V2` recovery anchor, verify every pasted artifact against canonical `sha256:` hashes, then run the public verifier. This restores trust-root evidence only; it does not give a person admin authority.
- Never persist pasted recovery artifacts, verifier responses, bootstrap cookies, unsigned bundles, JWTs, nonces, or secrets in browser storage.

### Releases and rollback

- Deploy the API only through the canonical staging/production workflow. Do not copy files directly to a server or run a second manual service.
- Require the exact API/protocol commits, successful tests/scans, reproducible archive evidence, release identity, local/public health checks, locked write surfaces, and security-header/proxy checks.
- Keep Uvicorn loopback-bound behind the reverse proxy; do not use `--reload`, a public application bind, or extra workers before coin selection is process-safe.
- A rollback changes the release symlink and restarts after validation; it does not undo chain state, ceremony coordinates, or shared databases. If schema compatibility is uncertain, stop and restore the matching checksummed state backup instead of pointing older code at newer data.

## Incident response

### Immediate response for any suspected compromise or chain inconsistency

1. Stop the affected write workflow. Keep minting and alpha writes locked or disable them through the approved emergency process.
2. Preserve evidence: timestamps, wallet address/public key, transaction/bundle IDs, chain state, release ID, logs, alerts, and reviewer communications. Do not overwrite ledgers, logs, or release/state directories.
3. Notify both administrators and the designated incident owner through the out-of-band incident channel.
4. Verify independently from authoritative chain state and signed artifacts. Do not rely on browser cache, API index, or an unverified screenshot.
5. Scope the incident: admin wallet, roster, API release, deployment manifest, bridge pool, validator/KoS signer, credential, or chain state.
6. Resume writes only after both administrators document containment, verification, required rotation/recovery, and approval to reopen the relevant gate.

### Specific stop conditions

| Condition | Required response |
| --- | --- |
| Admin wallet loss, theft, suspected seed exposure, or unexplained signature | Stop quorum-sensitive activity; preserve evidence; plan a reviewed roster removal/replacement using the current quorum. Do not issue a new wallet access based on a support request. |
| Authority roster/MIPS root/launcher mismatch | Stop all admin writes and sign-ins that depend on the mismatch; verify live singleton and signed records; do not override with an environment allowlist. |
| Unexpected chain spend, stale coin, replay, or ambiguous confirmation | Do not sign or retry blindly; preserve the input/state and rebuild only after root-cause review from current chain state. |
| Validator, KoS, artifact, release, or network mismatch | Treat health as failed; keep credential/mint writes locked. Never override the check. |
| Validator ledger corruption | Remove that signer from service, preserve evidence, restore a verified backup only to the same signer index/roster, and re-run full preflight. |
| Validator seed or private signer credential exposure | Retire the signer identity, keep writes locked, and use reviewed governance to establish the replacement signed artifact/bridge policy. |
| API/public proxy security regression | Stop deployment or roll back using the approved workflow; do not expose Uvicorn, docs, validator routes, or private signer interfaces to recover availability. |
| Ceremony failure or partial/ambiguous genesis | Abandon the ceremony state; do not reuse its coins, coordinates, artifacts, or secrets. Rotate as required and begin a fresh reviewed ceremony. |

## Actions administrators must never take

- Never share a wallet, seed phrase, private key, JWT, ceremony token, validator seed, KoS key, SSH key, mTLS key, RPC credential, or password.
- Never use a personal browser profile, untrusted extension, shared device, or unverified RPC origin to sign an admin action.
- Never enable write gates merely to test a screen, and never leave them enabled after the approved window.
- Never treat localStorage drafts, API indexes, a bearer token, an environment variable, or a candidate wallet as on-chain authority.
- Never bypass committee, quorum, owner, validator, or KoS requirements because an operation is urgent.
- Never manually modify shared state databases, ceremony records, release directories, or on-chain coordinates to repair an issue. Use reviewed recovery/change procedures.
- Never expose, proxy, or publish private validator/KoS services or generic signing endpoints.
- Never claim a collection, proposal, deed, offer, or credential is finalized until the required authoritative chain state is confirmed.

## Onboarding acceptance record

Do not activate an administrator until both current administrators and the candidate have completed and recorded:

- Identity/wallet verification and public-key fingerprint confirmation.
- Review of this runbook, security gate, admin authority model, genesis/recovery materials, and incident contacts.
- Hardware-wallet signing test on Testnet11 using the actual EIP-712 admin domain.
- Successful login only after roster confirmation, plus logout/session-expiry and rejected-membership tests.
- Trust-root and signed-artifact verification from independent chain reads.
- A supervised dry run of the two-person prepare/verify/archive workflow.
- Acknowledgment of the 2-of-2 availability and recovery risk.
- Confirmation that no personal, shared, or unapproved infrastructure access has been granted beyond the least privilege required for the assigned work.

## Open implementation gaps to track

These are operational constraints, not permissions to bypass controls:

- The `add-admin-slot`, `roster-spend-package-review`, `recovery`, `launch-authority-v2`, and `launch-protocol-config` components are not registered in `src/app/app.routes.ts`; route them before treating any of these flows as available in the deployed portal.
- The A.5 add-admin flow is preflight/export only; final spend construction, quorum signing, and broadcast must use a separately reviewed process.
- Mint creation writes browser-local drafts via `MintDraftStorageService`; on-chain publish returns 501 today, and SGT voting, execution, and offer creation are not yet wired in that path.
- Trust-root views perform live on-chain lineage confirmation, but some inner-puzzle/quorum fields remain placeholders until client-side uncurry support is completed.
- Define and test an approved two-admin removal/replacement and third-member availability plan before valuable writes are enabled.
- Assign named owners for production change management, key recovery custody, validator/KoS operations, monitoring/alerting, and incident communications before launch.
