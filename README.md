# Populis Portal

Members-only web portal for the Populis Protocol — user-facing vault
registration **and** the operator-side admin desk (mint proposals,
trust roots, key rotation) running entirely client-side via WASM.

**Stack**: Angular 20, Tailwind 3, ethers v6, `chia-wallet-sdk-wasm`,
coinset.org RPC.
**Backend**: [`../populis_api/`](../populis_api/) — narrowed to
faucet-funded vault registration only as of **Phase 9-Hermes-D**.
All other state (admin authority, mint proposals, property registry,
protocol config) is read directly from coinset.org and computed in
the browser via the Chia WASM SDK.

## Quick start

```bash
# 1. Faucet API (only needed for vault registration; everything else
#    works without it).  See ../populis_api/README.md.
cd ../populis_api && .venv/bin/uvicorn populis_api.app:app --port 8787 &

# 2. Portal
cd populis_portal
npm install --legacy-peer-deps   # once
npm start                        # → http://localhost:4200
```

## Configuration

Edit `src/environments/environment.ts`:

- `faucetApi` — URL of the faucet backend (default `http://localhost:8787`).
  *Renamed from `populisApi` in Phase 9-Hermes-D to reflect its
  narrowed role.*
- `coinsetRpc` — Chia full-node RPC (default `https://testnet11.api.coinset.org`).
  Used for both reads (`get_coin_record_by_name`, `get_puzzle_and_solution`)
  and writes (`push_tx`).
- `walletConnectProjectId` — get one at https://cloud.walletconnect.com
  (only needed for WalletConnect; MetaMask / Coinbase Wallet via
  injected provider work without it).
- `populisProtocol.*` — on-chain singleton coordinates: launcher ids and
  pinned mod hashes for the admin-authority (v1 + v2), protocol-config,
  property-registry, pool, and governance singletons. Empty values mean
  "not deployed on this network".
- `populisProtocol.adminAuthorityV2MipsRootHash` — pinned MIPS root for the
  v2 admin-authority singleton's CHIP-0043 quorum. Cross-checked against
  the on-chain `state_hash` so a stale env refuses logins instead of
  silently authenticating a removed admin.
- `eip712ChainId` — must match `EIP712_DOMAIN_CHAIN_ID` in
  `populis_protocol/populis_puzzles/vault_driver.py`.

## Architecture

The portal is **WASM-first**: the `chia-wallet-sdk-wasm` SDK runs in
the browser and the portal computes every puzzle hash, curry, and
state root client-side. The faucet API only handles the one operation
that needs an off-chain funded wallet — paying for a user's launcher
coin at vault registration.

**Two audiences served from the same SPA:**

- **User-facing** — connect an EVM or Chia wallet, sign an EIP-712
  envelope, the faucet API funds the launcher, the portal polls
  coinset.org until the vault is confirmed.
- **Admin desk (operators)** — connect an EVM admin wallet, the
  portal verifies membership in the on-chain v2 admin-authority
  quorum, then launches singletons / drafts mint proposals / rotates
  keys with bundles built and signed entirely in-browser.

**Key services:**

- `ChiaWasmService` — bootstraps `chia-wallet-sdk-wasm` (deep-imports
  the JS glue, fetches the `.wasm` binary, hand-instantiates,
  exposes the SDK on `window.ChiaSDK`).
- `OnChainStateService` — reads each trust-root singleton from
  coinset.org and verifies its `state_hash` against pinned mod hashes.
- `AdminAuthorityV2Service` — TS port of `admin_authority_v2_driver.py`,
  fixture-validated against the Python source.
- `MintProposalV2Service` — TS port of `mint_proposal_v2_driver.py`,
  fixture-validated against the Python source.
- `Eip712LeafHashService` — in-browser CHIP-0043 leaf hash for
  EIP-712 (Eip712Member) and BLS members.
- `AdminWalletAuthService` — EIP-712 challenge/response admin login
  bound to the v2 admin-authority quorum.
- `WalletCoinPickerService` — deterministic XCH coin selection for
  client-built spend bundles.
- `MintDraftStorageService` — client-side mint-proposal drafts before
  submission.

**External dependencies:**

- `coinset.org` testnet11 RPC — reads (`get_coin_record_by_name`,
  `get_puzzle_and_solution`, etc.) **and** writes (`push_tx`).
- `populis_api` — only `/auth/challenge` + `/vault/register/{evm,chia}`
  (faucet-funded launcher coin).

## Admin desk pages

| Route | Purpose |
|-------|---------|
| `/admin/login` | EIP-712 wallet challenge/response — verifies the connected wallet is in the v2 admin-authority quorum (or the env-pinned allowlist fallback). |
| `/admin/dashboard` | Top-level operator overview — health, faucet balance, deployment manifest. |
| `/admin/launch-authority-v2` | Launch the v2 admin-authority singleton: build the eve coin spend bundle client-side from the connected wallet's EVM address and push it via coinset.org. |
| `/admin/trust-roots` | Cross-checked view of the four A.x trust-root singletons (admin-authority v1+v2, protocol-config, property-registry) with on-chain `state_hash` verification against the pinned mod hashes. |
| `/admin/mint-new` | Draft a mint proposal locally (`MintDraftStorageService`); preview the curried `mint_proposal_inner_v2` puzzle hash and binding-hash before any chain interaction. |
| `/admin/mint-detail/:id` | Inspect a proposal, gather owner / gov member signatures, and submit APPROVE / CANCEL transitions client-side. |
| `/admin/committee` | Public PGT-VOTE view (no auth) — list active proposals and submit votes. |

## User-facing flow (vault registration)

The one flow that still touches the API — because the faucet pays for
the launcher coin:

```
  Wallet → portal           portal → faucet API           faucet API → chain
  signTypedData_v4   ────▶   POST /auth/challenge   ────▶   recover pubkey
                                                           select faucet UTXO
                            POST /vault/register/{evm,chia} build launcher bundle
                                                           sign + push_tx
                            poll GET /vault/{launcher_id}  confirm via coinset
```

For everything **after** registration — reading vault state, viewing
admin desk pages, signing admin-side proposals — the portal queries
coinset.org directly through `OnChainStateService` and recomputes
state hashes via `chia-wallet-sdk-wasm`. The faucet API is only needed
at the moment of registration.

## Cross-repo binding (Phase 9-Hermes-D)

The portal's TS ports of the v2 drivers are validated against JSON
fixtures generated from the Python source of truth:

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

The portal's Karma specs (`*.service.spec.ts`) re-check every fixture
on every test run, so drift surfaces as a test failure.

## Tests

```bash
npm test                              # → watch mode
npm test -- --watch=false --browsers=ChromeHeadless   # one-shot CI mode
```

112 Karma specs cover the v2 services, EIP-712 leaf hash, wallet
integration, coin-set RPC, and admin session flows.

## Development server

```bash
npm start
# → http://localhost:4200
```

## Build

```bash
npm run build
# artefacts in dist/populis_portal/
```

## Theme

The portal intentionally mirrors the Populis marketing site
(`/home/hiram/projects/Populis/populis/`) — dark premium minimal, algae-green
palette (`#7cffb2` / `#00d3a7`), Space Grotesk + Fraunces fonts.  See
`src/styles.scss` and `tailwind.config.js`.

## License

Proprietary — all rights reserved, Matthew S. Hintz.  See root `LICENSE`.
