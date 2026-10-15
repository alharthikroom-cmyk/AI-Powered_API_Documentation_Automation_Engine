import { Component, computed, inject } from '@angular/core';
import { StoreService } from '../store.service';

const STEPS = [
  ['Select API', 'Pick a proxy'],
  ['Apigee metadata', 'Read flows'],
  ['Splunk samples', 'Real traffic'],
  ['AI', 'Generates Swagger'],
  ['Review', 'Discuss and check'],
  ['Submit', 'Approve and store'],
];

@Component({
  selector: 'app-pipeline',
  template: `
    <nav class="pipeline" aria-label="Workflow steps">
      @for (s of steps(); track s.n) {
        <button
          class="step"
          [class.done]="s.done"
          [class.now]="s.current"
          [class.locked]="!s.open"
          [disabled]="!s.open || !store.detail()"
          [attr.aria-current]="s.current ? 'step' : null"
          (click)="store.goto(s.n)"
        >
          <span class="dot">{{ s.done && !s.current ? '✓' : s.n }}</span>
          <span class="t">{{ s.title }}</span>
          <span class="w">{{ s.what }}</span>
        </button>
      }
    </nav>
  `,
})
export class PipelineComponent {
  readonly store = inject(StoreService);
  readonly steps = computed(() => {
    this.store.detail();
    const cur = this.store.step();
    return STEPS.map(([title, what], i) => {
      const n = i + 1;
      return { n, title, what, done: this.store.done(n), current: n === cur, open: this.store.reachable(n) };
    });
  });
}
