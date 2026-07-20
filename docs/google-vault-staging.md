# Google Vault Staging

Google Vault is disabled by the checked-in runtime default. The staging release is the only environment that enables it, through public GitHub environment variables at build time.

Before running the staging configuration script, create a dedicated **Web application** OAuth client in Google Auth Platform manually. Keep the consent screen in testing mode, register only `https://staging.solslot.com` as an authorized JavaScript origin, add `solslot.com` as an authorized domain, and add the named test users. Browser OAuth clients use no client secret; do not create, upload, or configure one for the portal.

Also configure Cloudflare Access for `https://staging.solslot.com/genesis-admin/*` for the named administrators. This is independent of wallet membership, one-time ceremony credentials, and API authorization.

After committing and pushing the exact feature SHA on the current release branch, run:

```bash
node scripts/configure-google-vault-staging.mjs \
  --gcp-project YOUR_PROJECT_ID \
  --oauth-client-id YOUR_PUBLIC_WEB_CLIENT_ID \
  --release-sha YOUR_COMMITTED_40_CHAR_SHA \
  --confirm-oauth-prerequisites \
  --confirm-cloudflare-access
```

The script enables only `drive.googleapis.com`, creates or checks the GitHub `staging` environment, validates deployment secret names without printing their values, sets the two public runtime variables, dispatches the current release branch's workflow, and makes that workflow check out the exact `--release-sha` for deployment. It then waits for completion and checks `release.json` and the deployed CSP. It deliberately does not create or alter browser OAuth clients, Google consent settings, test users, or Cloudflare policies.

## Required Staging Evidence

Run and archive the following checks from two separate named test-user accounts before opening a pull request to `main`:

1. Create a Google Vault backup, reload the portal, confirm that the signing key is locked, then unlock it with OAuth and the recovery password.
2. Reset the recovery password and verify that Drive contains one replacement backup whose read-back content matches the newly encrypted envelope.
3. Use the explicit **Revoke Google access** action, confirm the local key/token state is cleared, then restore the same wallet from its mnemonic.
4. Attempt malformed, tampered, oversized, duplicate, and wrong-password backups. Each must fail closed without exposing a key.
5. Register the unchanged challenge through Google Vault, Goby, and Sage. Record the wallet type, returned public key, challenge digest, success/failure result, and browser version. The Google registration must match `scripts/fixtures/google-bls-testnet11-v1.json`.
6. Attempt an unsupported or unknown-key signing request and confirm that it is rejected. Confirm the visible review prompt warns that Google Vault is Testnet11-only and keeps its key in page memory while unlocked.

Do not enable Google Vault in production from this checklist. The checked-in runtime default remains disabled until a separate production OAuth and security review approves it.
