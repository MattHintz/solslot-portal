import { Component, input } from '@angular/core';
import { DraftProjectTeamV1 } from '../../services/property-metadata/property-dossier';

@Component({
  selector: 'pp-project-team-summary',
  standalone: true,
  template: `
    <section class="team" [class.compact]="compact()" aria-label="Project sponsor and builder">
      <article>
        <span class="role">Project sponsor</span>
        <h3>{{ team()?.sponsor?.displayName || team()?.sponsor?.legalName || 'Sponsor to be confirmed' }}</h3>
        @if (team()?.sponsor?.displayName && team()?.sponsor?.legalName) { <span class="legal">{{ team()?.sponsor?.legalName }}</span> }
        @if (!compact()) {
          @if (team()?.sponsor?.summary) { <p>{{ team()?.sponsor?.summary }}</p> }
          @if (team()?.sponsor?.website) { <a [href]="team()?.sponsor?.website" target="_blank" rel="noopener noreferrer">Sponsor website ↗</a> }
        }
      </article>
      <article>
        <span class="role">Builder / general contractor</span>
        <h3>{{ builderLabel() }}</h3>
        @if (team()?.builderIsSponsor) { <span class="badge">Also the project sponsor</span> }
        @if (!team()?.builderIsSponsor && builder()?.displayName && builder()?.legalName) { <span class="legal">{{ builder()?.legalName }}</span> }
        @if (!compact()) {
          @if (builder()?.summary) { <p>{{ builder()?.summary }}</p> }
          @if (builder()?.website) { <a [href]="builder()?.website" target="_blank" rel="noopener noreferrer">Builder website ↗</a> }
          @if (builder()?.licenseReference) { <small>License reference: {{ builder()?.licenseReference }} {{ builder()?.licenseJurisdiction }} · supplied for review</small> }
        }
      </article>
    </section>
  `,
  styles: [`
    .team { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1rem; margin:1.5rem 0; }
    article { min-width:0; padding:1.4rem; border:1px solid var(--border); border-radius:12px; background:var(--bg-2); }
    .role { color:var(--accent); font:600 .67rem var(--font-mono); text-transform:uppercase; letter-spacing:.1em; }
    h3 { color:var(--text); font-family:var(--font-sans); font-size:1.12rem; margin:.5rem 0; overflow-wrap:anywhere; }
    .legal,p,small { color:var(--muted); font-size:.82rem; line-height:1.6; overflow-wrap:anywhere; }
    p { margin:.7rem 0; } a { display:inline-block; color:var(--accent); font-size:.8rem; padding:.5rem 0; }
    small { display:block; margin-top:.5rem; font-size:.72rem; }
    .badge { display:inline-block; color:var(--accent); font-size:.72rem; }
    .compact article { padding:1rem; } .compact h3 { font-size:.95rem; } .compact { margin:1rem 0; }
    @media(max-width:600px) { .team { grid-template-columns:1fr; gap:.65rem; } }
  `],
})
export class ProjectTeamSummaryComponent {
  readonly team = input<DraftProjectTeamV1>();
  readonly compact = input(false);
  builder() { return this.team()?.builderIsSponsor ? this.team()?.sponsor : this.team()?.builder; }
  builderLabel(): string {
    if (this.team()?.builderStatus === 'not-appointed') return 'Not appointed yet';
    if (this.team()?.builderStatus === 'not-applicable') return 'No construction planned';
    return this.builder()?.displayName || this.builder()?.legalName || 'Builder to be confirmed';
  }
}
