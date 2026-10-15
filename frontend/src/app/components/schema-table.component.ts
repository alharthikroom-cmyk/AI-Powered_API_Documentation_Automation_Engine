import { Component, computed, input } from '@angular/core';
import { schemaRows } from '../format';
import { OpenApiDoc } from '../models';

@Component({
  selector: 'app-schema-table',
  template: `
    @if (rows().length) {
      <div class="scroll">
        <table class="tree">
          <thead><tr><th>Field</th><th>Type</th><th>Description</th><th>Example</th></tr></thead>
          <tbody>
            @for (r of rows(); track $index) {
              <tr>
                <td [style.padding-left.px]="10 + r.depth * 16">{{ r.name }}@if (r.required) {<span class="req"> *</span>}</td>
                <td class="ty">{{ r.type }}</td>
                <td>{{ r.description }}</td>
                <td class="ex">{{ r.example }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <div class="ex">{{ fallback() }}</div>
    }
  `,
})
export class SchemaTableComponent {
  readonly doc = input.required<OpenApiDoc>();
  readonly schema = input<OpenApiDoc | undefined>();
  readonly rows = computed(() => schemaRows(this.doc(), this.schema()));
  readonly fallback = computed(() => {
    const s = this.schema();
    if (!s) return '';
    return (s['type'] ?? '') + (s['example'] !== undefined ? ` · ${JSON.stringify(s['example'])}` : '');
  });
}
