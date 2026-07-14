# Solslot VPS Automation Study

Date: 2026-07-04

This note captures the useful parts of the historical Solslot automation without reintroducing retired Solslot offers as a product path. Old offer rows are forensic evidence only. New properties, deeds, and purchase artifacts should flow through the Solslot-Solslot merger path.

## VPS Shape

- Host studied: SolomonsLot VPS.
- Public frontend: Apache serves Solslot static assets and proxies `/rehoboam`, `/telonium`, and `/redemption`.
- Staging frontend: Apache serves `staging.solslot.com` and proxies staging Rehoboam/Telonium services.
- Active staging backend: `/opt/solslot-backend-staging/python/src`.
- Staging data clone: `/opt/solslot-backend-staging/STAGING_DATA_CLONE.md` records the 2026-07-04 production-to-staging clone.

## Historical Automation

- `powershell/functions.ps1` built Chia offers directly from wallet RPC.
- The helper pulled collection NFTs from MintGarden, filtered wallet-owned DACs through `nft_get_nfts`, fetched NFT driver data through `nft_get_info`, and assembled `create_offer_for_ids` payloads.
- XCH pricing used CoinGecko with a small local cache.
- Old generated artifacts were posted to Dexie or Splash, then sometimes pushed back to Solslot through `/private/reprice`.
- `powershell/rpcEndpoints.ps1` exposed a manual multi-offer builder with hard-coded valid collections/currencies and rejected master equity NFTs.
- `/private/mint` in Rehoboam created Solslot properties, shares, offer groups, and offer rows from already-prepared Chia offer IDs.
- `/private/reprice` updated or inserted seller offer rows after external offer generation.
- Reconciliation endpoints moved old offers through sale/cancel outcomes after manual/admin action.
- Shell and MySQL history show direct SQL was also used for one-off correction and launch work.

## Already-Upgraded Pieces

- Staging Rehoboam has `/protocol/purchase-intents` endpoints.
- Purchase intents store artifact JSON/hash and state in `protocol_purchase_intent`.
- Staging Telonium can attach protocol metadata to Stripe checkout/payment links.
- Stripe webhooks can call Rehoboam back through `/protocol/purchase-intents/stripe-webhook`.
- Rehoboam calls Solslot API endpoints:
  - `/protocol/offer-artifacts`
  - `/protocol/purchase-finalizations/verify`

## Coordinate Bridge Status

`_protocol_artifact_request` in staging Rehoboam builds the Solslot artifact request from Solslot property/share/offer rows and now passes optional Solslot acceptance coordinates when the active purchase-intent path supplies them:

- `poolLauncherId`
- `poolInnerPuzzleHash`
- `bridgePolicyHash`
- `membersMerkleRoot`
- `protocolConfigLauncherId`
- `vaultVersionRegistryLauncherId`

Those fields are represented on the portal-side offer artifact model. The bridge is now present in local code and staging:

- `solslot_api` accepts request-scoped coordinates and emits them into the protocol offer artifact.
- `research/solslot-backend` forwards camelCase or snake_case coordinate fields from `/protocol/purchase-intents`.
- `research/solslot-backend` no longer copies retired Solslot `chia_offer_id` rows into `raw_offer`; current raw Chia offer text must come from the active admin/API path.
- `research/solslot-frontend` can pass configured or local-storage coordinate fields into the purchase-intent request.
- VPS staging has `solslot-api-staging.service` listening internally on `127.0.0.1:8790`.
- VPS staging Rehoboam has `SOLSLOT_API_URL=http://127.0.0.1:8790`.
- Remote smoke testing confirmed Rehoboam forwards coordinates to Solslot API and does not reuse retired Solslot offer text as `raw_offer`.

## Moon Alpha Seed

The public-alpha mock market is seeded on staging as a protocol simulation, not a real property or investment offer:

- Market: `The Moon` (`market_id=10`).
- Property: `Invest-In-The-Moon` (`property_id=23`).
- Share/deed placeholder: `share_id=4060`, `nft_id=nftmoonalpha00000000000000000000000000000000000000000000000000`.
- Staging offer row: `offer_id=7704`, `status=NEW`, `currency=wUSDC.b`, `asking_price=50`.
- Frontend route: `https://staging.solslot.com/market/10/property/23`.
- API route: `https://staging.solslot.com/rehoboam/market/10/property/23`.
- Visual asset: `/assets/images/moon-alpha-smart-deed.svg`.

The offer row contains `chia_offer_id=offerMoonAlphaProtocolReadinessOnly` only because the historical Solslot schema expects an offer-shaped string. It is not a real Chia offer and must not be treated as `raw_offer`.

Remote artifact rehearsal against staging confirmed:

- Rehoboam built the Moon artifact request with `raw_offer = None`.
- Solslot API returned an artifact hash prefix `sha256:e9191a782de`.
- Deployment coordinates appear in the artifact payload fields (`poolLauncherId`, `poolInnerPuzzleHash`, `bridgePolicyHash`, `membersMerkleRoot`, `protocolConfigLauncherId`, `vaultVersionRegistryLauncherId`).
- Purchase/deed lifecycle fields appear in the protocol payload fields (`collectionId`, `deedLauncherId`, `propertyId`, `purchaseIntentId`, `sharePpm`, `vaultLauncherId`).

## Upgrade Direction

1. Keep `admin/legacy-recall` focused on Pro Account and Pro Vault customer recall.
2. Treat old Solslot offer rows as retired forensic records. Do not map them into active `OP:OFFER_READY` UI.
3. For new merged properties, use this lifecycle:
   - Solslot governance creates and executes the mint proposal.
   - The deed is minted and obtains a deed launcher id.
   - The admin/API purchase-intent path creates the offer artifact.
   - Solslot payment rails attach purchase-intent metadata.
   - Payment webhook/evidence calls back into Rehoboam.
   - Rehoboam asks Solslot to verify/finalize.
4. Next backend brick: replace staging placeholder protocol coordinates with real merger deployment coordinates, then run an end-to-end purchase-intent rehearsal for Chia/Base USDC/Stripe rails.
