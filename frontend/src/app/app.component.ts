import { Component, inject, OnInit } from '@angular/core';
import { HeaderComponent } from './components/header.component';
import { PipelineComponent } from './components/pipeline.component';
import { RailComponent } from './components/rail.component';
import { WorkspaceComponent } from './components/workspace.component';
import { StoreService } from './store.service';

@Component({
  selector: 'app-root',
  imports: [HeaderComponent, PipelineComponent, RailComponent, WorkspaceComponent],
  template: `
    <app-header />
    <div class="wrap">
      <header class="top">
        <p style="margin: 0">Builds a base spec from Apigee proxy metadata, adds real traffic samples from Splunk, and asks the AI to write the Swagger file for review.</p>
        <div class="sources">
          @if (store.sources(); as s) {
            <div class="src">
              <span>Apigee <b class="tabular">{{ s.apigee.proxies }} proxies</b> · <span class="mono">{{ s.apigee.organization }}/{{ s.apigee.environment }}</span></span>
              <label for="f-apigee">Replace</label>
              <input id="f-apigee" type="file" accept=".json,application/json" (change)="replace('apigee', $event)" />
            </div>
            <div class="src">
              <span>Splunk <b class="tabular">{{ s.splunk.events }} events</b> · <span class="mono">{{ s.splunk.index }}</span></span>
              <label for="f-splunk">Replace</label>
              <input id="f-splunk" type="file" accept=".json,application/json" (change)="replace('splunk', $event)" />
            </div>
          }
        </div>
      </header>
      <app-pipeline />
      <div class="main">
        <app-rail />
        <app-workspace />
      </div>
    </div>
  `,
})
export class AppComponent implements OnInit {
  readonly store = inject(StoreService);

  ngOnInit(): void {
    this.store.init();
  }

  replace(kind: 'apigee' | 'splunk', e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.store.replaceSource(kind, file);
    input.value = '';
  }
}
