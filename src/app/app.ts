import { afterNextRender, Component, EnvironmentInjector, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './layout/header/header.component';
import { FooterComponent } from './layout/footer/footer.component';
import { AlphaDisclosureComponent } from './layout/alpha-disclosure/alpha-disclosure.component';
import { AlphaObservabilityService } from './services/alpha-observability.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent, AlphaDisclosureComponent],
  template: `
    <pp-header />
    <pp-alpha-disclosure />
    <main class="min-h-[calc(100vh-20rem)]">
      <router-outlet />
    </main>
    <pp-footer />
  `,
})
export class App {
  private readonly injector = inject(EnvironmentInjector);
  private readonly alphaObservability = inject(AlphaObservabilityService);

  constructor() {
    afterNextRender(() => {
      this.alphaObservability.track('ALPHA_APP_OPENED', { route: location.pathname });
      void import('./services/chia-wallet.service').then(({ ChiaWalletService }) =>
        this.injector
          .get(ChiaWalletService)
          .restoreSageWalletConnectSession(),
      );
    });
  }
}
