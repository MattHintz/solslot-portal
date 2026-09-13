# Google Vault Staging

Google Vault is disabled by the checked-in runtime default. The staging release is the only environment that enables it, through public GitHub environment variables at build time.

Before running the staging configuration script, create a dedicated **Web application** OAuth client in Google Auth Platform manually. Keep the consent screen in testing mode, register only `https://staging.solslot.com` as an authorized JavaScript origin, add `solslot.com` as an authorized domain, and add the named test users. Browser OAuth clients use no client secret; do not create, upload, or configure one for the portal.

Also configure Cloudflare Access for `https://staging.solslot.com/genesis-admin/*` for the named administrators. This is independent of wallet membership, one-time ceremony credentials, and API authorization.

After the required release approval, with the exact feature SHA and coordinated tag already pushed on the current release branch, run:

```bash
node scripts/configure-google-vault-staging.mjs \
  --gcp-project YOUR_PROJECT_ID \
  --oauth-client-id YOUR_PUBLIC_WEB_CLIENT_ID \
  --release-sha YOUR_COMMITTED_40_CHAR_SHA \
  --release-tag YOUR_COORDINATED_RELEASE_TAG \
  --confirm-oauth-prerequisites \
  --confirm-cloudflare-access
```

The tag must use the workflow's coordinated format, such as `solslot-v2-alpha-rc27.41-20260907`; this example is not an approved release. Before changing cloud or GitHub configuration, the helper checks that the remote tag resolves to the requested SHA, that the release branch/workflow is available, and that all required deployment secret names exist. It never reads or prints secret values.

The script then enables `drive.googleapis.com`, creates or checks the GitHub `staging` environment, sets the two public runtime variables and dispatches the current release branch's workflow with both `release_sha` and `release_tag`. The workflow checks out and revalidates that release identity. After completion, the helper checks the served SHA, tag, staging environment, mount, test-only declaration, Google Vault configuration and CSP. These manifest declarations do not substitute for backend gate or transaction verification. Browser OAuth clients, Google consent settings, test users and Cloudflare policies remain console-managed prerequisites.

Run the isolated helper regression with `node --test scripts/configure-google-vault-staging.test.mjs`. It replaces all external commands and HTTP responses with disposable fixtures; it does not configure or deploy a service.

## Required Staging Evidence

Run and archive the following checks from two separate named test-user accounts before opening a pull request to `main`:

1. Create a Google Vault backup, reload the portal, confirm that the signing key is locked, then unlock it with OAuth and the recovery password.
2. Reset the recovery password and verify that Drive contains one replacement backup whose read-back content matches the newly encrypted envelope.
3. Use the explicit **Revoke Google access** action, confirm the local key/token state is cleared, then restore the same wallet from its mnemonic.
4. Attempt malformed, tampered, oversized, duplicate, and wrong-password backups. Each must fail closed without exposing a key.
5. Register the unchanged challenge through Google Vault, Goby, and Sage. Record the wallet type, returned public key, challenge digest, success/failure result, and browser version. The Google registration must match `scripts/fixtures/google-bls-testnet11-v1.json`.
6. Attempt an unsupported or unknown-key signing request and confirm that it is rejected. Confirm the visible review prompt warns that Google Vault is Testnet11-only and keeps its key in page memory while unlocked.

Do not enable Google Vault in production from this checklist. The checked-in runtime default remains disabled until a separate production OAuth and security review approves it.
