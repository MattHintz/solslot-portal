# Solslot Portal — Google Vault Staging Integration (Next Target Triage) - 2026-07-20

## Why the previous target was stale
The first triage relied on `solslot_migration_artifacts/legacy_v1_evidence_20260712/GLOBAL_AUDIT_COVERAGE_20260711.txt`, which is a snapshot from 2026-07-11. Since then the active branches have moved on:
- `solslot-portal` latest commit: `d35c0ee 2026-07-20 07:00` — `fix: validate branch workflow before staging config` on `feature/google-vault-staging`.
- `solslot` latest commit: `2382d63 2026-07-19 14:15` — release/testnet-alpha-rc17 security fixes.
- `populis_protocol` latest commit: `b50b7eb 2026-07-02 00:43` — pool-economic-v2; the POP-CANON-041/042 surface is still present but is a known, tracked issue, not the latest work.

The next audit target must therefore be the **most recent feature work**: the Google Vault staging integration in the operator portal.

## Selected target
- **Repository**: `solslot-portal` (`/home/hiram/CascadeProjects/windsurf-project-3/solslot-portal`)
- **Branch**: `feature/google-vault-staging`
- **Head commit**: `d35c0ee` (2026-07-20)
- **Scope**: browser-side vault backup crypto, Google Drive appDataFolder storage, BLS signing wallet, OAuth flow, and the deployment scripts/workflow that gate this to staging.
- **Adjacent recent surface** (sweep after this target): uncommitted `solslot/slui/src/app/services/omnichain-purchase.service.ts` and `wallet-connect.service.ts` changes (2026-07-20).

## Canon / felt context
- Internal pre-mainnet audit; no external program.
- Prior server hardening audit (2026-07-12) found no Critical/High code issues in `populis_api`.
- POP-CANON-041/042 remain open in the pool contract but are not part of this feature.

## Scope preflight
| Gate | Verdict |
|---|---|
| In-scope assets | `vault-backup-crypto.service.ts`, `google-drive-vault.service.ts`, `google-bls-wallet.service.ts`, `connect.component.ts`, `scripts/configure-google-vault-staging.mjs`, `scripts/prepare-google-vault-runtime.mjs`, `.github/workflows/deploy-ceremony-portal.yml` |
| Out-of-scope | Live Google infrastructure, operator endpoints, unrelated SLUI omnichain purchase (swept separately) |
| Testing restrictions | Local unit tests / static review only; no live OAuth phishing, no deployment to staging/production |
| Attacker model | User is phished into running attacker-controlled coin spends / backups; XSS can read page-memory tokens; build config can be mis-set to enable testnet-only code in production |

## Boundary ledger
| Boundary | Chooser | Payer | Decision | Privileged/expensive action before decision | Cleanup | Coupling | Risk |
|---|---|---|---|---|---|---|---|
| Backup encryption | user-supplied password + random salt/iv | user mnemonic | `VaultBackupCryptoService.encrypt` derives PBKDF2 key and seals mnemonic | none (password checked for length only) | plaintext zeroed in finally | AES-GCM + AAD over metadata; 600k PBKDF2 iterations | **Medium** — weak-password brute force; AAD bypass would leak mnemonic |
| Google Drive backup load | Google Drive appDataFolder contents | wallet availability | `GoogleDriveVaultService.loadBackup` parses remote JSON and calls `crypto.parse` | none | access token cleared on 401 | Drive scope `drive.appdata` per OAuth client | **Medium** — malicious backup must pass strict envelope schema; rollback to mnemonic if Drive unavailable |
| BLS signing of arbitrary spend bundle | caller-supplied `coinSpends[]` | user private key in page memory | `GoogleBlsWalletService.signSpendBundle` runs puzzle+solution and signs AGG_SIG conditions | `puzzle.run(..., MAX_BLOCK_COST_CLVM, false)` | Wasm objects freed in finally | no time/cost bound beyond CLVM cost | **Medium-High** — malicious spend bundle can freeze/crash the browser wallet |
| Staging deployment gating | `configure-google-vault-staging.mjs` + GitHub variables | portal release | script sets `SOLSLOT_GOOGLE_VAULT_ENABLED=true` only for `staging` env, workflow checks out exact SHA | dirty-worktree check, branch-ancestor check, required secrets existence | rollback workflow available | runtime default file is disabled; build script validates client ID | **Medium** — misconfiguration or workflow bypass could enable Google Vault in production |

## Candidate probes
| ID | Class | Smallest proof | Fastest falsifier |
|---|---|---|---|
| GV-01 | CRYPTO-AAD / metadata tampering | Unit test: flip a metadata field after encryption and assert `decrypt` rejects | Read `decrypt` AAD path at `@/home/hiram/CascadeProjects/windsurf-project-3/solslot-portal/src/app/services/vault-backup-crypto.service.ts:131-184` |
| GV-02 | AUTHZ-LOCKOUT / duplicate backup | Unit test: inject two `solslot_vault_backup_v1.json` files and assert lockout | `@/home/hiram/CascadeProjects/windsurf-project-3/solslot-portal/src/app/services/google-drive-vault.service.ts:78-104` |
| GV-03 | DOS-WALLET / underpriced CLVM spend | Harness: feed `signSpendBundle` a near-match/divmod-heavy spend and measure browser freeze | `@/home/hiram/CascadeProjects/windsurf-project-3/solslot-portal/src/app/services/google-bls-wallet.service.ts:98-121` |
| GV-04 | CONFIG-ESCAPE / production enablement | Static check: prove `googleVaultRuntime.enabled` cannot become true for `chiaNetwork !== testnet11` | `@/home/hiram/CascadeProjects/windsurf-project-3/solslot-portal/src/environments/google-vault-runtime.default.ts:1-9` and `@/home/hiram/CascadeProjects/windsurf-project-3/solslot-portal/scripts/prepare-google-vault-runtime.mjs:1-36` |
| GV-05 | SECRET-LIFECYCLE / XSS token theft | Review: confirm access token is never persisted to localStorage | `@/home/hiram/CascadeProjects/windsurf-project-3/solslot-portal/src/app/services/google-drive-vault.service.ts:21-23, 58-60` |

## First work block
1. **Read the remaining high-touch files**:
   - `@/home/hiram/CascadeProjects/windsurf-project-3/solslot-portal/src/app/pages/connect/connect.component.ts:1-319`
   - `@/home/hiram/CascadeProjects/windsurf-project-3/solslot-portal/src/app/services/vault-backup-crypto.service.spec.ts`
   - `@/home/hiram/CascadeProjects/windsurf-project-3/solslot-portal/src/app/services/google-drive-vault.service.spec.ts`
   - `@/home/hiram/CascadeProjects/windsurf-project-3/solslot-portal/src/app/services/google-bls-wallet.service.spec.ts`
   - `@/home/hiram/CascadeProjects/windsurf-project-3/solslot-portal/scripts/render-apache-headers.mjs`
   - `@/home/hiram/CascadeProjects/windsurf-project-3/solslot-portal/src/environments/environment.shared.ts`
2. **Run existing verification**:
   ```bash
   cd /home/hiram/CascadeProjects/windsurf-project-3/solslot-portal
   npm run security:google-bls
   npm run security:headers
   npm run prepare:google-vault-runtime
   ```
3. **Build two regression harnesses**:
   - `vault-backup-crypto.service.tamper.spec.ts` — mutates each metadata field and ciphertext, asserts every tamper fails with `VaultBackupCryptoError`.
   - `google-bls-wallet.dos.spec.ts` — creates a coin spend whose puzzleReveal runs a high-cost CLVM pattern within `MAX_BLOCK_COST_CLVM` and asserts signing completes within a wall-time budget (e.g., 2s) or is rejected.

## Kill condition for this target
If the existing test suite already contains coverage equivalent to GV-01 through GV-05 with passing assertions, downgrade this target to a quick verification pass and pivot to the SLUI omnichain purchase surface.
