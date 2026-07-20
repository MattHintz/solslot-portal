/**
 * Checked-in fail-closed defaults. `prepare-google-vault-runtime.mjs` copies
 * this shape into the ignored runtime file during a release build.
 */
export const googleVaultRuntime = {
  enabled: false,
  oauthClientId: '',
} as const;
