import { Component, computed, inject } from '@angular/core';
import { ProxySummary } from '../models';
import { StoreService } from '../store.service';

@Component({
  selector: 'app-rail',
  template: `
    <aside class="rail" aria-label="API proxies">
      <div class="stats">
        <div class="stat ok"><b>{{ counts().approved }}</b><span>Approved</span></div>
        <div class="stat rv"><b>{{ counts().active }}</b><span>In progress</span></div>
        <div class="stat"><b>{{ counts().idle }}</b><span>Not started</span></div>
      </div>
      <h3 style="margin-top: 6px">Apigee proxies</h3>
      @for (p of store.proxies(); track p.name) {
        <button class="api" [attr.aria-current]="p.name === store.selected()" (click)="store.select(p.name)" [disabled]="!!store.busy()">
          <span class="row">
            <span class="name">{{ p.name }}</span>
            <span [class]="'pill ' + pill(p).cls">{{ pill(p).label }}</span>
          </span>
          <span class="meta mono">{{ p.basePath }} · rev {{ p.revision }}</span>
          <span class="meta tabular">{{ p.flows }} flows · {{ p.events }} Splunk events</span>
          <span class="mini" aria-hidden="true">
            @for (i of six; track i) { <i [class.on]="filled(p, i)"></i> }
          </span>
        </button>
      }
    </aside>
  `,
})
export class RailComponent {
  readonly store = inject(StoreService);
  readonly six = [1, 2, 3, 4, 5, 6];
  readonly counts = computed(() => {
    const ps = this.store.proxies();
    const approved = ps.filter(p => p.status === 'approved').length;
    const active = ps.filter(p => p.status !== 'approved' && p.completed > 0).length;
    return { approved, active, idle: ps.length - approved - active };
  });

  filled(p: ProxySummary, i: number): boolean {
    return i <= 4 ? p.completed >= i : p.completed >= 6;
  }

  pill(p: ProxySummary): { cls: string; label: string } {
    if (p.status === 'approved') return { cls: 'approved', label: 'Approved' };
    if (p.status === 'review') return { cls: 'review', label: p.pending ? `${p.pending} pending` : 'In review' };
    if (p.completed > 0) return { cls: 'active', label: 'In progress' };
    if (!p.events) return { cls: 'nosamples', label: 'No logs' };
    return { cls: 'undocumented', label: 'Not started' };
  }
}
