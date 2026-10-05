import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DraftProjectTeamV1, ProjectPartyV1 } from '../../services/property-metadata/property-dossier';

@Component({
  selector: 'pp-project-team-form',
  standalone: true,
  imports: [FormsModule],
  template: `
    <p class="intro">Identify who sponsors the project and who will build it. These profiles appear in the property preview. Keep private contact details in restricted documents.</p>
    <fieldset [disabled]="disabled()">
      <legend>Project sponsor</legend>
      <p>The person or entity organizing and sponsoring this project. The legal issuer is recorded separately in Legal structure.</p>
      <div class="fields">
        <label>Sponsor legal name<input [(ngModel)]="team().sponsor.legalName" (ngModelChange)="changed.emit()" maxlength="240" autocomplete="organization" /></label>
        <label>Sponsor public name <small>Optional</small><input [(ngModel)]="team().sponsor.displayName" (ngModelChange)="changed.emit()" maxlength="180" /></label>
        <label class="wide">Sponsor website <small>Optional · HTTPS</small><input type="url" [(ngModel)]="team().sponsor.website" (ngModelChange)="changed.emit()" maxlength="500" placeholder="https://" /></label>
        <label class="wide">About the sponsor <small>Optional</small><textarea rows="3" [(ngModel)]="team().sponsor.summary" (ngModelChange)="changed.emit()" maxlength="1200"></textarea></label>
      </div>
    </fieldset>
    <fieldset [disabled]="disabled()">
      <legend>Builder / general contractor</legend>
      <p>The party responsible for construction. A project can name a separate builder or use the sponsor in both roles.</p>
      <label class="same-party"><input type="checkbox" [ngModel]="team().builderIsSponsor" (ngModelChange)="setSameParty($event)" /><span>Sponsor is also the builder</span></label>
      @if (team().builderIsSponsor) {
        <div class="linked-party" role="status"><strong>{{ team().sponsor.displayName || team().sponsor.legalName || 'Add the sponsor name above' }}</strong><span>One entity, two roles. Builder details use the sponsor profile.</span></div>
        <div class="fields">
          <label>Builder license reference <small>Optional</small><input [(ngModel)]="team().sponsor.licenseReference" (ngModelChange)="changed.emit()" maxlength="180" /></label>
          <label>License jurisdiction <small>Optional</small><input [(ngModel)]="team().sponsor.licenseJurisdiction" (ngModelChange)="changed.emit()" maxlength="100" /></label>
        </div>
      } @else {
        <label>Builder appointment
          <select [ngModel]="team().builderStatus || ''" (ngModelChange)="setBuilderStatus($event)">
            <option value="">Select a status</option><option value="selected">Builder selected</option><option value="not-appointed">Not appointed yet</option><option value="not-applicable">No construction planned</option>
          </select>
        </label>
        @if (team().builderStatus === 'selected' && team().builder; as builder) {
          <div class="fields">
            <label>Builder legal name<input [(ngModel)]="builder.legalName" (ngModelChange)="changed.emit()" maxlength="240" autocomplete="organization" /></label>
            <label>Builder public name <small>Optional</small><input [(ngModel)]="builder.displayName" (ngModelChange)="changed.emit()" maxlength="180" /></label>
            <label class="wide">Builder website <small>Optional · HTTPS</small><input type="url" [(ngModel)]="builder.website" (ngModelChange)="changed.emit()" maxlength="500" placeholder="https://" /></label>
            <label class="wide">About the builder <small>Optional</small><textarea rows="3" [(ngModel)]="builder.summary" (ngModelChange)="changed.emit()" maxlength="1200"></textarea></label>
            <label>Builder license reference <small>Optional</small><input [(ngModel)]="builder.licenseReference" (ngModelChange)="changed.emit()" maxlength="180" /></label>
            <label>License jurisdiction <small>Optional</small><input [(ngModel)]="builder.licenseJurisdiction" (ngModelChange)="changed.emit()" maxlength="100" /></label>
          </div>
        }
      }
      <p class="note">Profiles and license references are supplied for review; entering them does not verify a license or establish ownership.</p>
    </fieldset>
  `,
  styles: [`
    :host { display:grid; gap:1.5rem; }
    .intro,fieldset > p { color:var(--muted); font-size:.84rem; line-height:1.65; margin:0 0 1rem; }
    fieldset { min-width:0; border:1px solid var(--border); border-radius:12px; padding:1.3rem; }
    legend { color:var(--text); font-weight:650; padding:0 .45rem; font-size:1.1rem; }
    .fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1rem; }
    label { display:grid; gap:.4rem; color:var(--text); font-size:.8rem; margin:0; }
    small { color:var(--muted); font-size:.72rem; font-weight:400; }
    input,textarea,select { width:100%; min-width:0; min-height:44px; border:1px solid var(--border); border-radius:6px; background:var(--bg-2); color:var(--text); padding:.65rem .75rem; font:inherit; }
    textarea { resize:vertical; }
    input:focus-visible,textarea:focus-visible,select:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
    .wide { grid-column:1/-1; }
    .same-party { display:flex; align-items:center; gap:.65rem; min-height:44px; margin-bottom:1rem; }
    .same-party input { width:20px; min-height:20px; accent-color:var(--accent); }
    .linked-party { display:grid; gap:.3rem; padding:1rem; margin-bottom:1rem; border-radius:8px; background:rgba(124,255,178,.06); border:1px solid var(--border); }
    .linked-party span { color:var(--muted); font-size:.8rem; }
    fieldset > .note { font-size:.73rem; margin:1rem 0 0; }
    @media(max-width:600px) { .fields { grid-template-columns:1fr; } fieldset { padding:1rem; } }
  `],
})
export class ProjectTeamFormComponent {
  readonly team = input.required<DraftProjectTeamV1>();
  readonly disabled = input(false);
  readonly changed = output<void>();
  private separateBuilder: Partial<ProjectPartyV1> | undefined;

  setSameParty(selected: boolean): void {
    const team = this.team();
    if (selected) {
      this.separateBuilder = team.builder;
      team.builder = undefined;
      team.builderStatus = 'selected';
    } else {
      team.builder = this.separateBuilder || {};
    }
    team.builderIsSponsor = selected;
    this.changed.emit();
  }

  setBuilderStatus(value: DraftProjectTeamV1['builderStatus'] | ''): void {
    const team = this.team();
    if (team.builder) this.separateBuilder = team.builder;
    team.builderStatus = value || undefined;
    team.builder = value === 'selected' ? this.separateBuilder || {} : undefined;
    this.changed.emit();
  }
}
