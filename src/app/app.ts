import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './layout/header/header.component';
import { FooterComponent } from './layout/footer/footer.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent],
  template: `
    <pp-header />
    <main class="min-h-[calc(100vh-20rem)]">
      <router-outlet />
    </main>
    <pp-footer />
  `,
})
export class App {}
