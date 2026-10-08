import {
  ApplicationConfig,
  inject,
  provideBrowserGlobalErrorListeners,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { journeyHttpInterceptor } from './services/journey-http.interceptor';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { routes } from './app.routes';
import { SolslotProtocolArtifactService } from './services/solslot-protocol-artifact.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([journeyHttpInterceptor])),
    provideAnimationsAsync(),
    provideAppInitializer(() =>
      inject(SolslotProtocolArtifactService).initialize(),
    ),
  ],
};
