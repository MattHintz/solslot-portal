# Populis Portal

Members-only web portal for the Populis Protocol.  Connect an EVM wallet
(MetaMask, Coinbase Wallet, WalletConnect) or a Chia wallet (Sage, Goby) to
create your private vault singleton on Chia testnet.

**Stack**: Angular 20, Tailwind 3, wagmi + WalletConnect + ethers v6, coinset.org RPC.
**Backend**: [`../populis_api/`](../populis_api/) — FastAPI service that recovers
your secp256k1 pubkey from EIP-712 signatures, builds the launcher bundle, and
broadcasts it via coinset.org.

## Quick start

```bash
# 1. Backend must be running first.  See ../populis_api/README.md.
cd ../populis_api && .venv/bin/uvicorn populis_api.app:app --port 8787 &

# 2. Portal
cd populis_portal
npm install --legacy-peer-deps   # once
npm start                        # → http://localhost:4200
```

Frontend requests to `/api/*` are proxied to the backend on `:8787` via
`proxy.conf.json`.

## Configuration

Edit `src/environments/environment.ts`:

- `populisApi` — URL of the backend (default `http://localhost:8787`)
- `coinsetRpc` — Chia full-node RPC (default `https://testnet11.api.coinset.org`)
- `walletConnectProjectId` — get one at https://cloud.walletconnect.com (only
  needed for WalletConnect; MetaMask / Coinbase Wallet via injected provider
  work without it)

## Flow

```
 ┌────────────┐   1. Connect EVM wallet (MetaMask / WC)
 │   Portal   │ ──────────────────────────────────────────┐
 │ (Angular)  │                                            ▼
 └────┬───────┘                                 ┌──────────────────┐
      │ 2. POST /auth/challenge                 │  Populis API     │
      │  (address, auth_type=evm)               │  (FastAPI)       │
      │                                         └──────────────────┘
      │ 3. challenge.typed_data ←──────────────┘
      │ 4. wallet.signTypedData_v4(typed_data) → signature
      │
      │ 5. POST /vault/register/evm
      │    { address, nonce, signature }
      │                                         ┌──────────────────┐
      │    ┌───────────────────────────────────▶│   recover pubkey │
      │    │                                    │   select faucet  │
      │    │                                    │   build launcher │
      │    │        push_tx                     │   sign (AGG_SIG) │
      │    │◀───────────────────────────────────┤   push           │
      │    │                                    └─────┬────────────┘
      │    ▼                                          │
 ┌──────────────────┐                                  │
 │ coinset.org      │◀─────────────────────────────────┘
 │ testnet11 RPC    │
 └──────────────────┘
```

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
