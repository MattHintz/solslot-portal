# Populis Portal

Angular portal for Populis vault registration and operator tooling on
Chia testnet11. The current architecture is coinset/WASM-first: browser
code uses `chia-wallet-sdk-wasm`, wallet signatures, and coinset.org RPC
for chain reads and most transaction construction.

**Stack**: Angular 20, Tailwind 3, ethers v6, `chia-wallet-sdk-wasm`,
Goby/Sage wallet APIs, WalletConnect, coinset.org RPC.

**Backend dependency**: [`../populis_api/`](../populis_api/) is used for
server-funded first-time vault creation (`/auth/challenge`,
`/vault/register/{evm,chia}`) and for the genesis bootstrap ceremony
(`/admin/deploy/protocol`, `/admin/bootstrap/challenge`,
`/admin/bootstrap/status`, `/admin/bootstrap/finalize`). Returning-user
vault discovery, admin login, trust-root reads, and mint-proposal drafts
are browser-side flows. The admin-authority-v2 launch spend is built and
pushed browser-side; only the post-launch bootstrap finalize step records
public deployment artifacts through the API.

## Quick start

```bash
# 1. Faucet/API server.
#    Needed for first-time vault creation and genesis bootstrap endpoints.
#    Returning users and most admin pages read chain state directly.
cd ../populis_api && .venv/bin/uvicorn populis_api.app:app --port 8787 &

# 2. Portal
cd populis_portal
npm install --legacy-peer-deps   # once
npm start                        # -> http://localhost:4200
```

## Configuration

Edit `src/environments/environment.ts`:

- `faucetApi` — URL of the Populis faucet/API backend. Used by the
  first-time vault creation path and by genesis bootstrap endpoints.
- `coinsetRpc` — Chia full-node RPC. Defaults to
  `https://testnet11.api.coinset.org` and is used for reads and
  `push_tx`.
- `walletConnectProjectId` — required for WalletConnect; injected EVM
  wallets work without it.
- `populisProtocol.*` — build-time singleton coordinates and mod hashes
  for pool, governance, admin-authority v1/v2, protocol-config,
  property-registry, and mint-proposal puzzle identification.
- `populisProtocol.adminAuthorityV2MipsRootHash` — current admin-login
  pin for the v2 authority path. Today the portal verifies a 1-of-1
  EIP-712 MIPS root or falls back to the configured EVM address
  allowlist. General multi-admin Merkle-path membership verification is
  not decoded client-side yet and fails closed.
- `eip712ChainId` — must match `EIP712_DOMAIN_CHAIN_ID` in
  `populis_protocol/populis_puzzles/vault_driver.py`.

## What is live today

### User vault flow

1. User connects an EVM or Chia wallet.
2. Portal gets a nonce from the faucet API and asks the wallet to sign.
3. Portal derives the owner pubkey and first checks coinset.org for an
   existing vault using the deterministic CHIP-22 discovery hint.
4. If no vault exists, the portal calls
   `POST /vault/register/{evm,chia}` so the API can fund and sign the
   singleton launcher spend from the faucet wallet.
5. Portal refreshes vault state by walking singleton lineage directly
   from coinset.org.

The API is not used for returning-user vault discovery or current-state
lookup.

### Operator/admin flow

- **Genesis ceremony** — `/admin/genesis` starts the full genesis flow:
  deploy the base protocol manifest with the one-shot operator token,
  start a short-lived bootstrap session cookie, continue into first-admin
  authority creation, and finalize public artifacts. The token holder does
  not become admin automatically; the selected wallet is bound as admin
  slot `0`. After finalization, `bootstrap_manifest.json` locks the
  bootstrapper and the page hands off to permanent admin login.
- **Admin login** — local EIP-712 `PopulisAdminLogin` signature, pubkey
  recovery in the browser, and membership check against the pinned
  1-of-1 v2 MIPS root or fallback EVM address allowlist. No
  `/admin/auth/login` API call.
- **Trust roots** — environment-pinned launcher ids plus coinset.org
  singleton lineage reads. The portal derives latest `state_hash`
  values when the protocol announcement can be replayed. Inner curry
  fields such as quorum lists are still placeholders until client-side
  uncurry support lands.
- **First-admin authority creation, genesis-only** —
  `/admin/launch-authority-v2` computes the v2 inner puzzle hash, launcher
  id, eve coin, state hash, and records JSON in WASM, asks Goby/Sage to
  sign the funding spend, combines it with the permissionless launcher
  spend, and pushes the bundle directly to coinset.org. When opened
  through temporary bootstrap access, it finalizes the public bootstrap
  artifacts through `POST /admin/bootstrap/finalize` using cookie
  credentials only, with no bearer token or browser storage persistence.
- **A.5 add-admin roster update, preview/review only** —
  `/admin/authority-v2/add-admin-slot` captures a candidate admin wallet,
  computes the append-only roster update locally, exports
  `admin_authority_v2_roster_update_unsigned_package.json`, and locally
  preflights the unsigned package.
  `/admin/authority-v2/roster-spend-package-review` imports pasted package
  JSON, runs the same local preflight, and renders the signer-facing
  summary. Both screens are no-signing and no-broadcast boundaries.
- **Bootstrap recovery** — `/admin/recovery` scans chain-visible
  `POPULIS_BOOTSTRAP_V1` marker memos, shows verified recovery anchors and
  rejected candidate reasons, locally checks pasted public artifacts against
  the selected anchor's canonical `sha256:` hashes, then calls the public
  verifier endpoint before handing off to permanent admin login.
- **Mint proposals** — current UI creates and lists browser-local DRAFT
  records in `localStorage`. Computed deed/proposal hashes, on-chain
  proposal ids, PGT voting, publish, and execute are not wired in this
  portal path yet.

## Path A recovery drill

Use this drill after a successful first-admin bootstrap to prove the
installation is recoverable without trusting the original portal host:

1. Open `/admin/launch-authority-v2` in bootstrap mode after
   `/admin/bootstrap/finalize` has returned the public artifacts.
2. Fetch the recovery publish intent and `CREATE_COIN` preview, connect a
   Chia wallet, and broadcast the one-mojo marker coin carrying the
   `POPULIS_BOOTSTRAP_V1` tag memo plus the canonical
   `bootstrap_recovery_anchor.json` payload memo.
3. Wait until the marker transaction is visible through coinset.org.
4. Open `/admin/recovery` from any portal build pointed at the same
   `coinsetRpc` network and click **Scan chain**.
5. Confirm the expected anchor appears. If malformed candidates are present,
   expand **Rejected candidate details** and verify they are unrelated or
   explainable indexer/wallet artifacts.
6. Paste `bootstrap_manifest.json`, `portal_runtime_config.json`, and
   `admin_records.json`. Paste `deployment_manifest.json` as well when full
   replay material is available.
7. Verify that all local hash checks match the selected anchor, then run the
   public verifier. A verified result re-establishes public trust roots; it
   does not grant admin authority by itself.
8. Continue to `/admin/login` with the recorded admin slot `0` wallet and
   perform normal permanent admin login.

The recovery page must not persist pasted artifacts, anchors, verifier
responses, bootstrap cookies, or handoff bundles in browser storage.

## A.5 roster-update authorization model

A.5 roster updates are `admin_authority_v2` singleton spends with
`SPEND_ADMIN_ROSTER_UPDATE = 0x07` and spend name `ADMIN_ROSTER_UPDATE`.
The only protocol authorizer for this add-admin path is the **current
`admin_authority_v2` MIPS quorum** committed in `current.mips_root_hash`.

This means:

- The candidate admin wallet does not authorize its own addition.
- The Populis API backend is optional cross-check infrastructure only and
  is not an authority source for roster changes.
- PGT committee approval is not part of this A.5 add-admin path unless a
  future governance design explicitly adds a separate spend path.
- The bootstrap operator token cannot authorize post-genesis roster
  updates.

Each A.5 roster update must append exactly one admin slot, preserve
existing admin records as a prefix, preserve `pending_ops_hash`, and
increment `authority_version` by one. The post-update MIPS root is
recomputed from the updated roster using the admin supermajority threshold.
For example, the initial second-admin update is authorized by the current
`1-of-1` first-admin MIPS root and moves the authority to a `2-of-2` root;
later additions are authorized by whatever current supermajority root is
live before the spend.

The unsigned package and review screen remain no-signing and no-broadcast
boundaries until the local signer receives the current MIPS puzzle reveal,
current MIPS quorum solution, live singleton coin, and wallet signature over
the final Chia spend bundle.

## Key services

- `PopulisApiService` — faucet API client for registration challenges
  and first-time vault launch only.
- `VaultDiscoveryService` — chain-native vault lookup via CHIP-22 hints
  and singleton lineage walking.
- `CoinsetService` — coinset.org JSON-RPC wrapper, including `push_tx`.
- `ChiaWasmService` — bootstraps `chia-wallet-sdk-wasm`.
- `AdminWalletAuthService` / `AdminSessionService` — browser-only admin
  login and session state.
- `AdminGenesisService` — one-shot protocol genesis deployment/status
  client for `/admin/deploy/protocol` and `/admin/deployment`.
- `AdminBootstrapService` — short-lived bootstrap challenge/status/finalize
  client. Finalize posts public first-admin commitments and receives
  `bootstrap_manifest` plus `portal_runtime_config`; it does not send an
  admin bearer token.
- `OnChainStateService` — trust-root reads shaped like the legacy API
  responses but sourced from environment constants and coinset.org.
- `AdminAuthorityV2Service` — TypeScript/WASM port of selected
  `admin_authority_v2_driver.py` helpers and the authority-v2 launch
  submit path.
- `MintDraftStorageService` — browser `localStorage` mint DRAFT store.
- `MintProposalV2Service` — fixture-validated TypeScript port of the
  v2 mint-proposal hash helpers; not yet the backing store for a
  chain-submitted proposal UI.

## Routes

| Route | Purpose |
|-------|---------|
| `/connect` | Connect EVM or Chia wallet. |
| `/create-vault` | Discover an existing vault or call the faucet API to create one. |
| `/vault` | Current vault view backed by chain discovery. |
| `/admin/genesis` | Full genesis ceremony entry: base protocol deploy, temporary bootstrap-session start/status, first-admin authority handoff, and locked post-finalize permanent-admin handoff. |
| `/admin/login` | Browser-only admin login. |
| `/admin` | Operator dashboard for browser-local mint drafts. |
| `/admin/launch-authority-v2` | Genesis-only first-admin authority step: build, wallet-sign, push the v2 authority launch bundle, and finalize public bootstrap artifacts in temporary bootstrap mode. |
| `/admin/recovery` | Public Path A bootstrap recovery: discover marker anchors, review rejected candidates, hash-check pasted artifacts, and call the recovery verifier before permanent admin login. |
| `/admin/trust-roots` | Read configured trust-root singleton state from coinset.org. |
| `/admin/authority-v2/add-admin-slot` | Build and locally preflight an unsigned A.5 add-admin roster-update package; no signing or broadcast. |
| `/admin/authority-v2/roster-spend-package-review` | Import pasted unsigned A.5 roster package JSON, rerun local preflight, and review signer-facing inputs; no signing or broadcast. |
| `/admin/mint/new` | Create a local DRAFT mint proposal. |
| `/admin/mint/:id` | Inspect or cancel a local DRAFT; publish/execute are disabled. |
| `/committee` | Public committee page shell; chain-backed PGT-VOTE submission is not wired yet. |

## Cross-repo binding

The portal's TypeScript ports are validated against JSON fixtures
generated from `populis_protocol`:

| Service | Python source | Fixture |
|---------|---------------|---------|
| `AdminAuthorityV2Service` | `populis_protocol/populis_puzzles/admin_authority_v2_driver.py` | `src/app/services/admin-authority-v2/admin-authority-v2.fixtures.json` |
| `MintProposalV2Service` | `populis_protocol/populis_puzzles/mint_proposal_v2_driver.py` | `src/app/services/mint-proposal-v2/mint-proposal-v2.fixtures.json` |

If the `.clsp` source changes, regenerate via:

```bash
cd ../populis_protocol
bash scripts/dump_v2_puzzle_hex.sh
bash scripts/dump_mint_proposal_v2_puzzle_hex.sh
.venv/bin/python scripts/dump_v2_fixtures.py
.venv/bin/python scripts/dump_mint_proposal_v2_fixtures.py
```

The Karma specs re-check the fixtures so drift surfaces as a test
failure.

`src/app/docs/a5-roster-update-authorization.contract.ts` pins the A.5
authorization model in testable form. Its Karma spec asserts that the
current `admin_authority_v2` MIPS quorum is the sole authorizer for this
add-admin path, that candidate wallets/API/committee/bootstrap tokens are
not authorizers, and that the updated roster uses supermajority semantics.

## Tests

```bash
npm test
npm test -- --watch=false --browsers=ChromeHeadless
```

## Build

```bash
npm run build
# artefacts in dist/populis_portal/
```

## Theme

The portal uses the Populis dark premium minimal theme: algae-green
accents, Space Grotesk + Fraunces fonts, and Tailwind utility styling.
See `src/styles.scss` and `tailwind.config.js`.

## License

Proprietary — all rights reserved, Matthew S. Hintz. See root
`LICENSE`.
