import { Component, computed, effect, inject, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { highlightJson } from '../format';
import { StoreService } from '../store.service';
import { ChecksTabComponent, DiscussTabComponent, InputTabComponent, SwaggerTabComponent } from './tabs.component';

const time = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '');

@Component({
  selector: 'app-step-select',
  template: `
    @if (store.detail(); as d) {
      <div class="screen">
        <div class="screen-h">
          <span class="eyebrow">Step 1 of 6</span>
          <h2>Select the API to document</h2>
          <p>Pick a proxy from the list on the left. The engine reads its definition from Apigee, adds real traffic from Splunk, and the AI writes the Swagger file for you to review.</p>
        </div>
        <dl class="facts">
          <div><dt>Proxy</dt><dd class="mono">{{ d.name }}</dd></div>
          <div><dt>Base path</dt><dd class="mono">{{ d.basePath }}</dd></div>
          <div><dt>Revision</dt><dd class="mono">{{ d.revision }}</dd></div>
          <div><dt>Flows</dt><dd class="tabular">{{ d.flows }}</dd></div>
          <div><dt>Splunk events</dt><dd class="tabular">{{ d.events }}</dd></div>
          <div><dt>Status</dt><dd>{{ statusText() }}</dd></div>
        </dl>
        @if (!d.events) {
          <div class="note warn">This proxy has no traffic in Splunk. The AI will document only its paths, methods and parameters.</div>
        }
        <div class="screen-f">
          @if (!d.completed) {
            <button class="primary" (click)="store.start()" [disabled]="!!store.busy()">Start documentation</button>
          } @else {
            <button class="primary" (click)="store.goto(resume())">Continue to step {{ resume() }}</button>
            <button (click)="confirming.set(true)" [disabled]="!!store.busy()">Start over</button>
          }
        </div>
        @if (confirming()) {
          <div class="note warn confirm-row">
            <span>Start over? The current Swagger and discussion for this API are cleared. Earlier versions stay in history.</span>
            <span class="actions">
              <button (click)="confirming.set(false)">Cancel</button>
              <button class="danger" (click)="restart()">Start over</button>
            </span>
          </div>
        }
      </div>
    }
  `,
})
export class StepSelectComponent {
  readonly store = inject(StoreService);
  readonly confirming = signal(false);
  readonly resume = computed(() => {
    const c = this.store.completed();
    return c >= 6 ? 6 : c >= 4 ? 5 : c + 1;
  });
  readonly statusText = computed(() => {
    const d = this.store.detail();
    if (!d) return '';
    if (d.status === 'approved') return 'Approved';
    if (d.status === 'review') return 'In review';
    return d.completed ? `In progress, step ${d.completed + 1}` : 'Not started';
  });

  async restart(): Promise<void> {
    this.confirming.set(false);
    await this.store.restart();
  }
}

@Component({
  selector: 'app-step-apigee',
  template: `
    @if (store.detail(); as d) {
      <div class="screen">
        <div class="screen-h">
          <span class="eyebrow">Step 2 of 6</span>
          <h2>Read the proxy from Apigee</h2>
          <p>The engine calls the Apigee Edge management API for the deployed revision and turns each conditional flow into an OpenAPI operation.</p>
        </div>
        <div class="callbox">
          <span class="lbl">Management API call</span>
          <code>{{ call() }}</code>
        </div>
        @if (store.busy() === 'apigee') {
          <div class="progress"><span class="spin"></span>Connecting to Apigee and reading revision {{ d.revision }}…</div>
        }
        @if (d.apigee; as a) {
          <div class="note good">Fetched {{ time(a.fetchedAt) }} · {{ a.flows.length }} flow{{ a.flows.length === 1 ? '' : 's' }} mapped to operations</div>
          <dl class="facts">
            <div><dt>Organization</dt><dd class="mono">{{ a.organization }}</dd></div>
            <div><dt>Environment</dt><dd class="mono">{{ a.environment }}</dd></div>
            <div><dt>Revision</dt><dd class="mono">{{ a.proxy.revision }}</dd></div>
            <div><dt>Base path</dt><dd class="mono">{{ a.proxy.basePath }}</dd></div>
            <div><dt>Virtual host</dt><dd class="mono">{{ a.proxy.virtualHost }}</dd></div>
            <div><dt>Target server</dt><dd class="mono">{{ a.proxy.targetServer || '–' }}</dd></div>
          </dl>
          <div class="scroll">
            <table>
              <thead><tr><th>Apigee flow</th><th>Condition</th><th>Operation</th><th>Path parameters</th></tr></thead>
              <tbody>
                @for (f of a.flows; track f.name) {
                  <tr>
                    <td class="mono">{{ f.name }}</td>
                    <td class="mono cond">{{ f.condition }}</td>
                    <td><span [class]="'m ' + f.method">{{ f.method.toUpperCase() }}</span> <span class="mono">{{ f.path }}</span></td>
                    <td class="mono">{{ f.params.join(', ') || '–' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (a.skipped.length) {
            <div class="note warn">Skipped flows without a path and verb condition: {{ a.skipped.join(', ') }}</div>
          }
        }
        <div class="screen-f">
          @if (!d.apigee) {
            <button class="primary" (click)="store.fetchApigee()" [disabled]="!!store.busy() || store.approved()">Fetch proxy metadata</button>
          } @else {
            <button class="primary" (click)="store.goto(3)">Continue to Splunk samples</button>
            @if (d.completed < 4) {
              <button (click)="store.fetchApigee()" [disabled]="!!store.busy()">Fetch again</button>
            }
          }
        </div>
      </div>
    }
  `,
})
export class StepApigeeComponent {
  readonly store = inject(StoreService);
  readonly time = time;
  readonly call = computed(() => {
    const d = this.store.detail();
    const s = this.store.sources();
    if (d?.apigee) return d.apigee.managementCall;
    return d && s ? `GET /v1/organizations/${s.apigee.organization}/apis/${d.name}/revisions/${d.revision}/proxies/default` : '';
  });
}

@Component({
  selector: 'app-step-splunk',
  imports: [FormsModule],
  template: `
    @if (store.detail(); as d) {
      <div class="screen">
        <div class="screen-h">
          <span class="eyebrow">Step 3 of 6</span>
          <h2>Pull real traffic from Splunk</h2>
          <p>Recent Apigee message logs are matched to each operation. Up to 5 samples per operation are added as hints, so the AI documents real fields and values instead of guessing.</p>
        </div>
        <div class="callbox">
          <span class="lbl">Splunk search</span>
          <code>{{ query() }}</code>
        </div>
        <label class="toggle big">
          <input type="checkbox" id="mask" [ngModel]="store.mask()" (ngModelChange)="store.mask.set($event)" [disabled]="!!store.busy() || d.completed >= 4" />
          <span><b>Mask personal data</b> · national IDs, names, mobile numbers and birth dates are pseudonymized before anything is sent to the AI</span>
        </label>
        @if (store.busy() === 'splunk') {
          <div class="progress"><span class="spin"></span>Searching Splunk and matching events to flows…</div>
        }
        @if (d.splunk; as s) {
          <div class="tiles">
            <div class="tile"><b>{{ s.totalEvents }}</b><span>Events found</span></div>
            <div class="tile ok"><b>{{ s.matched }}</b><span>Matched to flows</span></div>
            <div class="tile" [class.rv]="s.unmatched"><b>{{ s.unmatched }}</b><span>Unmatched</span></div>
            <div class="tile"><b>{{ s.mask ? 'On' : 'Off' }}</b><span>Masking</span></div>
          </div>
          @if (!s.totalEvents) {
            <div class="note warn">No traffic found for this proxy. The AI will keep only paths, methods and parameters and will not invent fields.</div>
          } @else if (sampled() < s.operations.length) {
            <div class="note warn">{{ sampled() }} of {{ s.operations.length }} operations have samples. The others keep only their path, method and parameters.</div>
          }
          <div class="scroll">
            <table>
              <thead><tr><th>Operation</th><th>Apigee flow</th><th>Samples</th><th>Status codes seen</th></tr></thead>
              <tbody>
                @for (o of s.operations; track o.method + o.path) {
                  <tr>
                    <td><span [class]="'m ' + o.method">{{ o.method.toUpperCase() }}</span> <span class="mono">{{ o.path }}</span></td>
                    <td class="mono">{{ o.flow }}</td>
                    <td class="tabular">{{ o.samples }}</td>
                    <td class="mono">{{ o.codes.join(', ') || '–' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @for (p of s.previews; track p.method + p.path) {
            <details class="sample">
              <summary><span [class]="'m ' + p.method">{{ p.method.toUpperCase() }}</span> <span class="mono">{{ p.path }}</span> <span class="muted">· sample with status {{ p.status }}{{ s.mask ? ' · masked' : '' }}</span></summary>
              <div class="sample-b">
                @if (p.pathParams || p.query) {
                  <div><h3>Path and query</h3><pre class="code" [innerHTML]="json({ path: p.pathParams, query: p.query })"></pre></div>
                }
                @if (p.request) {
                  <div><h3>Request body</h3><pre class="code" [innerHTML]="json(p.request)"></pre></div>
                }
                <div><h3>Response body</h3><pre class="code" [innerHTML]="json(p.response)"></pre></div>
              </div>
            </details>
          }
        }
        <div class="screen-f">
          @if (!d.splunk) {
            <button class="primary" (click)="store.fetchSplunk()" [disabled]="!!store.busy() || store.approved()">Pull samples from Splunk</button>
          } @else {
            <button class="primary" (click)="store.goto(4)">Continue to AI generation</button>
            @if (d.completed < 4) {
              <button (click)="store.fetchSplunk()" [disabled]="!!store.busy()">Pull again</button>
            }
          }
        </div>
      </div>
    }
  `,
})
export class StepSplunkComponent {
  readonly store = inject(StoreService);
  readonly json = (v: unknown) => highlightJson(v);
  readonly sampled = computed(() => this.store.detail()?.splunk?.operations.filter(o => o.samples).length ?? 0);
  readonly query = computed(() => {
    const d = this.store.detail();
    const s = this.store.sources();
    if (d?.splunk) return d.splunk.query;
    return d && s ? `search index=${s.splunk.index} sourcetype="${s.splunk.sourcetype}" proxy="${d.name}" earliest=-7d | head 500` : '';
  });
}

@Component({
  selector: 'app-step-ai',
  imports: [InputTabComponent, FormsModule],
  template: `
    @if (store.detail(); as d) {
      <div class="screen">
        <div class="screen-h">
          <span class="eyebrow">Step 4 of 6</span>
          <h2>Generate the Swagger file with AI</h2>
          <p>The base spec from Apigee and the samples from Splunk are sent to the AI with the documentation rules (prompt v0.6). It writes schemas, descriptions, examples and operation IDs, and removes the hints.</p>
        </div>
        @if (store.offline()) {
          <div class="note warn">
            <b>No AI is connected.</b> Use a free option below, or connect a free AI provider: set <code>AI_PROVIDER=groq</code> and <code>AI_API_KEY</code> in <code>backend/.env</code>, then run <code>npm run ai:check</code>.
          </div>
        }
        <div class="tiles">
          <div class="tile"><b class="small">{{ store.offline() ? 'Not configured' : store.sources()?.brain?.model }}</b><span>AI model</span></div>
          <div class="tile"><b class="small">v0.6</b><span>Prompt</span></div>
          <div class="tile"><b>{{ d.splunk?.operations?.length ?? 0 }}</b><span>Operations</span></div>
          <div class="tile"><b>{{ samples() }}</b><span>Samples sent</span></div>
        </div>
        @if (store.busy() === 'generate') {
          <div class="progress">
            <span class="spin"></span>
            <span>{{ phase() }} <span class="muted tabular">· {{ elapsed() }}s</span></span>
          </div>
        }
        @if (d.spec && store.busy() !== 'generate') {
          <div class="note good">Swagger version {{ d.specVersion }} ready · {{ passed() }} of {{ d.checks?.length ?? 0 }} validation checks pass</div>
        }
        @if (!store.approved()) {
          <details class="sample alt" [open]="store.offline() || !!store.error()">
            <summary>No AI credit? Generate for free</summary>
            <div class="sample-b alt-b">
              <div class="alt-opt">
                <h3>Option A · Use claude.ai (free with your Claude subscription)</h3>
                <ol>
                  <li><button (click)="copy()" [disabled]="!!store.busy()">{{ copied() ? 'Prompt copied' : 'Copy full prompt' }}</button></li>
                  <li>Open <a href="https://claude.ai/new" target="_blank" rel="noopener">claude.ai</a>, paste it into a new chat and send.</li>
                  <li>Copy Claude's whole reply and paste it here:</li>
                </ol>
                <textarea id="manual" [(ngModel)]="pasted" rows="6" spellcheck="false" placeholder='{ "openapi": "3.0.3", ... }' aria-label="Swagger JSON from claude.ai"></textarea>
                <div><button class="primary" (click)="usePasted()" [disabled]="!!store.busy() || !pasted.trim()">Use this Swagger</button></div>
              </div>
              <div class="alt-opt">
                <h3>Option B · Offline draft</h3>
                <p class="muted">A basic draft built locally from the samples. Good for walking through the steps; the descriptions are simple.</p>
                <div><button (click)="store.generateOffline()" [disabled]="!!store.busy()">Use offline draft</button></div>
              </div>
            </div>
          </details>
        }
        <details class="sample" (toggle)="store.loadInput()">
          <summary>Show exactly what is sent to the AI</summary>
          <div class="sample-b"><app-input-tab /></div>
        </details>
        <div class="screen-f">
          @if (!d.spec) {
            <button class="primary" (click)="store.generate()" [disabled]="!!store.busy() || store.approved()">{{ store.busy() === 'generate' ? 'Generating…' : 'Generate Swagger' }}</button>
          } @else {
            <button class="primary" (click)="store.goto(5)" [disabled]="store.busy() === 'generate'">Continue to review</button>
            @if (!store.approved()) {
              <button (click)="store.generate()" [disabled]="!!store.busy()">{{ store.busy() === 'generate' ? 'Generating…' : 'Regenerate' }}</button>
            }
          }
        </div>
      </div>
    }
  `,
})
export class StepAiComponent implements OnDestroy {
  readonly store = inject(StoreService);
  readonly copied = signal(false);
  pasted = '';

  async copy(): Promise<void> {
    if (await this.store.copyPrompt()) {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    }
  }

  async usePasted(): Promise<void> {
    if (await this.store.generateManual(this.pasted)) this.pasted = '';
  }
  readonly elapsed = signal(0);
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly samples = computed(() => (this.store.detail()?.splunk?.operations ?? []).reduce((n, o) => n + Math.min(o.samples, 5), 0));
  readonly passed = computed(() => this.store.detail()?.checks?.filter(c => c.ok).length ?? 0);
  readonly phase = computed(() => {
    const t = this.elapsed();
    if (t < 3) return 'Sending the base spec and samples to the AI…';
    if (t < 15) return 'The AI is writing schemas and descriptions…';
    if (t < 45) return 'Still writing. Larger APIs take up to a minute or two…';
    return 'Almost there. Finishing and validating the file…';
  });

  constructor() {
    effect(() => {
      const running = this.store.busy() === 'generate';
      if (running && !this.timer) {
        this.elapsed.set(0);
        this.timer = setInterval(() => this.elapsed.update(v => v + 1), 1000);
      } else if (!running && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    });
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

@Component({
  selector: 'app-step-review',
  imports: [SwaggerTabComponent, DiscussTabComponent, ChecksTabComponent],
  template: `
    @if (store.detail(); as d) {
      <div class="screen flush">
        <div class="screen-h pad">
          <span class="eyebrow">Step 5 of 6</span>
          <h2>Review with the AI</h2>
          <p>Read the generated documentation, ask the AI about anything, and accept or reject the changes it proposes. Every accepted change is validated again.</p>
        </div>
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" data-t="swagger" [attr.aria-selected]="store.reviewTab() === 'swagger'" (click)="store.reviewTab.set('swagger')">Generated Swagger</button>
          <button class="tab" role="tab" data-t="discuss" [attr.aria-selected]="store.reviewTab() === 'discuss'" (click)="store.reviewTab.set('discuss')">
            Discuss with AI@if (store.pending()) {<span class="c">{{ store.pending() }} pending</span>}
          </button>
          <button class="tab" role="tab" data-t="checks" [attr.aria-selected]="store.reviewTab() === 'checks'" (click)="store.reviewTab.set('checks')">
            Validation<span class="c">{{ passed() }}/{{ d.checks?.length ?? 0 }}</span>
          </button>
        </div>
        <div class="pbody">
          @switch (store.reviewTab()) {
            @case ('swagger') { <app-swagger-tab /> }
            @case ('discuss') { <app-discuss-tab /> }
            @case ('checks') { <app-checks-tab /> }
          }
        </div>
      </div>
    }
  `,
})
export class StepReviewComponent {
  readonly store = inject(StoreService);
  readonly passed = computed(() => this.store.detail()?.checks?.filter(c => c.ok).length ?? 0);
}

@Component({
  selector: 'app-step-submit',
  imports: [FormsModule],
  template: `
    @if (store.detail(); as d) {
      <div class="screen">
        @if (store.approved()) {
          <div class="confirm">
            <span class="big-check" aria-hidden="true">✓</span>
            <div>
              <span class="eyebrow">Step 6 of 6 · Submitted</span>
              <h2>{{ d.name }} is documented and approved</h2>
              <p>Swagger version {{ d.specVersion }} is stored in the registry and ready to publish.</p>
            </div>
          </div>
          <dl class="facts">
            <div><dt>Approved by</dt><dd>{{ d.approvedBy }}</dd></div>
            <div><dt>Approved at</dt><dd>{{ time(d.approvedAt) }}</dd></div>
            <div><dt>Spec version</dt><dd class="tabular">{{ d.specVersion }}</dd></div>
            <div><dt>Validation</dt><dd>{{ passed() }}/{{ d.checks?.length ?? 0 }} checks</dd></div>
            <div><dt>Changes accepted in review</dt><dd class="tabular">{{ d.acceptedChanges }}</dd></div>
            <div><dt>Generated by</dt><dd>{{ d.specSource === 'mock' ? 'Offline draft' : d.specSource === 'manual' ? 'claude.ai (pasted)' : store.sources()?.brain?.model ?? 'AI' }}</dd></div>
          </dl>
          @if (d.approvalNote) { <div class="note"><b>Reviewer note:</b> {{ d.approvalNote }}</div> }
          <div class="screen-f">
            @if (store.downloadUrl(); as url) { <a class="btn primary" [href]="url" download>Download Swagger JSON</a> }
            @if (nextApi(); as n) { <button (click)="store.select(n)">Document next API: {{ n }}</button> }
            <button (click)="store.reopen()" [disabled]="!!store.busy()">Reopen for review</button>
          </div>
        } @else {
          <div class="screen-h">
            <span class="eyebrow">Step 6 of 6</span>
            <h2>Approve and submit</h2>
            <p>Confirm the review is complete. The approved Swagger file is stored in the registry with your name.</p>
          </div>
          <div class="checks">
            <div class="check" [class.ok]="store.allChecksOk()" [class.no]="!store.allChecksOk()">
              <span class="i">{{ store.allChecksOk() ? '✓' : '✕' }}</span>
              <span>All validation checks pass<small>{{ passed() }} of {{ d.checks?.length ?? 0 }} pass</small></span>
            </div>
            <div class="check" [class.ok]="!store.pending()" [class.no]="!!store.pending()">
              <span class="i">{{ store.pending() ? '✕' : '✓' }}</span>
              <span>No proposed changes waiting<small>{{ store.pending() ? store.pending() + ' waiting for a decision in step 5' : 'All AI proposals decided' }}</small></span>
            </div>
          </div>
          <dl class="facts">
            <div><dt>API</dt><dd class="mono">{{ d.name }}</dd></div>
            <div><dt>Revision</dt><dd class="mono">{{ d.revision }}</dd></div>
            <div><dt>Spec version</dt><dd class="tabular">{{ d.specVersion }}</dd></div>
            <div><dt>Changes accepted</dt><dd class="tabular">{{ d.acceptedChanges }}</dd></div>
          </dl>
          <form class="signoff" (ngSubmit)="store.approve()">
            <label for="reviewer">Reviewer name</label>
            <input id="reviewer" name="reviewer" [ngModel]="store.reviewer()" (ngModelChange)="store.reviewer.set($event)" autocomplete="name" maxlength="100" placeholder="Your full name" />
            <label for="note">Note <span class="muted">(optional)</span></label>
            <textarea id="note" name="note" [ngModel]="store.note()" (ngModelChange)="store.note.set($event)" maxlength="1000" rows="3" placeholder="Anything the next reader should know"></textarea>
            <div class="screen-f">
              <button class="primary" type="submit" [disabled]="!store.readyToSubmit() || !store.reviewer().trim()">Approve and submit</button>
              @if (!store.readyToSubmit()) { <button type="button" (click)="store.goto(5)">Back to review</button> }
            </div>
          </form>
        }
      </div>
    }
  `,
})
export class StepSubmitComponent {
  readonly store = inject(StoreService);
  readonly time = time;
  readonly passed = computed(() => this.store.detail()?.checks?.filter(c => c.ok).length ?? 0);
  readonly nextApi = computed(() => this.store.proxies().find(p => p.status !== 'approved' && p.name !== this.store.selected())?.name ?? null);
}
