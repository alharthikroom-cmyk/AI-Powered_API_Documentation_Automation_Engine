import { Component, computed, inject } from '@angular/core';
import { StoreService } from '../store.service';
import { StepAiComponent, StepApigeeComponent, StepReviewComponent, StepSelectComponent, StepSplunkComponent, StepSubmitComponent } from './steps.component';

@Component({
  selector: 'app-workspace',
  imports: [StepSelectComponent, StepApigeeComponent, StepSplunkComponent, StepAiComponent, StepReviewComponent, StepSubmitComponent],
  template: `
    <section class="panel">
      @if (store.detail(); as d) {
        <div class="phead">
          <div style="min-width: 0">
            <h2 class="mono" style="overflow-wrap: anywhere">{{ d.name }}</h2>
            <dl>
              <div><dt>Base path</dt><dd>{{ d.basePath }}</dd></div>
              <div><dt>Revision</dt><dd>{{ d.revision }}</dd></div>
              <div><dt>Target</dt><dd>{{ d.targetServer || '–' }}</dd></div>
            </dl>
          </div>
          <span [class]="'pill ' + pill().cls">{{ pill().label }}</span>
        </div>
        @if (store.error(); as e) {
          <div class="pbody" style="padding-bottom: 0"><div class="note bad" role="alert">{{ e }}</div></div>
        }
        @switch (store.step()) {
          @case (1) { <app-step-select /> }
          @case (2) { <app-step-apigee /> }
          @case (3) { <app-step-splunk /> }
          @case (4) { <app-step-ai /> }
          @case (5) { <app-step-review /> }
          @case (6) { <app-step-submit /> }
        }
        @if (store.step() === 5) {
          <div class="review" [class.pending]="store.pending() > 0" [class.ready]="store.approved() || store.readyToSubmit()">
            <span style="font-size: 14px">
              @if (store.approved()) {
                <span class="pill approved">Approved</span> <span class="muted">by {{ d.approvedBy }}</span>
              } @else if (store.pending()) {
                <span style="color: var(--warn)">{{ store.pending() }} proposed change{{ store.pending() === 1 ? '' : 's' }} waiting.</span> Accept or reject before submitting.
              } @else if (store.allChecksOk()) {
                All checks pass. When you are happy with the documentation, continue to submit.
              } @else {
                <span style="color: var(--bad)">{{ failing() }} check{{ failing() === 1 ? '' : 's' }} failing.</span> Fix them in the JSON view, discuss with the AI, or regenerate.
              }
            </span>
            <span class="actions">
              @if (d.spec && store.downloadUrl(); as url) { <a class="btn" [href]="url" download>Download JSON</a> }
              <button class="primary" (click)="store.goto(6)" [disabled]="!store.readyToSubmit() && !store.approved()">Continue to submit</button>
            </span>
          </div>
        }
      } @else if (store.error()) {
        <div class="pbody"><div class="note bad" role="alert">{{ store.error() }}</div></div>
      } @else {
        <div class="empty">Loading…</div>
      }
    </section>
  `,
})
export class WorkspaceComponent {
  readonly store = inject(StoreService);
  readonly failing = computed(() => this.store.detail()?.checks?.filter(c => !c.ok).length ?? 0);
  readonly pill = computed(() => {
    const d = this.store.detail();
    if (!d) return { cls: 'undocumented', label: '' };
    if (d.status === 'approved') return { cls: 'approved', label: 'Approved' };
    if (d.status === 'review') return { cls: 'review', label: 'In review' };
    if (d.completed) return { cls: 'active', label: 'In progress' };
    return { cls: 'undocumented', label: 'Not started' };
  });
}
