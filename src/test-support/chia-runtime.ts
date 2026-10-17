import { initializeVerifiedChiaRuntime, verifiedChiaRuntime } from '../app/utils/verified-chia-runtime';

/** All suites share the production initializer: replacing bg.js memory strands live WASM objects. */
export async function initializeChiaTestRuntime(): Promise<void> {
  await initializeVerifiedChiaRuntime();
  const sdk = verifiedChiaRuntime();
  if ((window as any).ChiaSDK !== sdk) (window as any).ChiaSDK = sdk;
}
