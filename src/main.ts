import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

import {initializeVerifiedChiaRuntime,verifiedChiaRuntime} from './app/utils/verified-chia-runtime';

async function initializeChiaWasm(): Promise<void> {
  if (Object.prototype.hasOwnProperty.call(window,'ChiaSDK')) {
    throw new Error('Unexpected Chia runtime existed before verified initialization.');
  }
  await initializeVerifiedChiaRuntime();
  Object.defineProperty(window,'ChiaSDK',{value:verifiedChiaRuntime(),writable:false,configurable:false});
}

initializeChiaWasm()
  .catch((err) => {
    // Swallow here so Angular bootstraps even when WASM init fails;
    // ChiaWasmService surfaces the disabled state to the UI.
    console.error('[main] Continuing with Chia WASM disabled:', err);
  })
  .finally(() => {
    bootstrapApplication(App, appConfig).catch((err) => console.error(err));
  });
