import { Component, computed, effect, ElementRef, inject, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { chatHtml, docOperations, highlightJson, short } from '../format';
import { StoreService } from '../store.service';
import { SchemaTableComponent } from './schema-table.component';

@Component({
  selector: 'app-input-tab',
  template: `
    <div class="actions">
      <span class="muted" style="font-size: 14px">The base spec from Apigee with Splunk samples added as hint fields. This is what is sent to the AI with prompt v0.6.</span>
      <button (click)="copy()">{{ copied ? 'Copied' : 'Copy input' }}</button>
    </div>
    <pre class="code" [innerHTML]="html()"></pre>
  `,
})
export class InputTabComponent {
  readonly store = inject(StoreService);
  readonly html = computed(() => (this.store.input() ? highlightJson(this.store.input()) : ''));
  copied = false;

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(JSON.stringify(this.store.input(), null, 2));
      this.copied = true;
      setTimeout(() => (this.copied = false), 1400);
    } catch {
      this.store.error.set('The browser blocked copying. Select the JSON and copy it manually.');
    }
  }
}

@Component({
  selector: 'app-swagger-tab',
  imports: [SchemaTableComponent, FormsModule],
  template: `
    @if (store.busy() === 'generate') {
      <div class="note" style="display: flex; gap: 10px; align-items: center"><span class="spin"></span>The AI is writing the Swagger file…</div>
    }
    @if (store.detail(); as d) {
      @if (!d.spec) {
        @if (store.busy() !== 'generate') {
          <div class="empty">No Swagger yet. Go back to step 4 to generate it.</div>
        }
      } @else {
        <div class="actions">
          <span class="seg">
            <button [attr.aria-pressed]="store.view() === 'docs'" (click)="store.view.set('docs')">Docs</button>
            <button [attr.aria-pressed]="store.view() === 'json'" (click)="openJson()">JSON</button>
          </span>
          <span class="muted mono" style="font-size: 12px">version {{ d.specVersion }} · {{ d.specSource }}</span>
          @if (store.view() === 'json' && !store.approved()) {
            <button (click)="store.saveJson(raw)" [disabled]="!!store.busy()">Save edits</button>
          }
        </div>
        @if (store.view() === 'docs') {
          <div>
            <h2>{{ d.spec['info']?.title }} <span class="muted mono" style="font-size: 13px; font-weight: 400">v{{ d.spec['info']?.version }}</span></h2>
            <p style="margin: 6px 0 0; max-width: 75ch">{{ d.spec['info']?.description }}</p>
            <p class="mono muted" style="margin: 6px 0 0; font-size: 13px">{{ servers() }}</p>
          </div>
          @for (t of d.spec['tags'] ?? []; track t.name) {
            <div class="note"><b class="mono">{{ t.name }}</b> {{ t.description }}</div>
          }
          @for (o of ops(); track o.method + o.path) {
            <article class="op">
              <div class="op-h">
                <span [class]="'m ' + o.method">{{ o.method.toUpperCase() }}</span>
                <span class="p">{{ o.path }}</span>
                <span class="id">{{ o.op['operationId'] }}</span>
                @if (!store.approved()) {
                  <button class="ask" (click)="store.ask(o.method.toUpperCase() + ' ' + o.path)">Discuss</button>
                }
              </div>
              <div class="op-b">
                @if (o.op['summary']) { <b>{{ o.op['summary'] }}</b> }
                @if (o.op['description']) { <p>{{ o.op['description'] }}</p> }
                @if (o.params.length) {
                  <div>
                    <h3>Parameters</h3>
                    <div class="scroll">
                      <table>
                        <thead><tr><th>Name</th><th>In</th><th>Type</th><th>Description</th><th>Example</th></tr></thead>
                        <tbody>
                          @for (p of o.params; track p['name'] + p['in']) {
                            <tr>
                              <td class="mono">{{ p['name'] }}@if (p['required']) {<span class="req"> *</span>}</td>
                              <td>{{ p['in'] }}</td>
                              <td class="ty">{{ p['schema']?.type }}{{ p['schema']?.format ? ' · ' + p['schema'].format : '' }}</td>
                              <td>{{ p['description'] }}</td>
                              <td class="ex">{{ p['example'] ?? p['schema']?.example ?? '' }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  </div>
                }
                @if (o.bodySchemas.length) {
                  <div>
                    <h3>Request body</h3>
                    @for (s of o.bodySchemas; track $index) { <app-schema-table [doc]="d.spec" [schema]="s" /> }
                  </div>
                }
                <div>
                  <h3>Responses</h3>
                  @for (r of o.responses; track r.code) {
                    <div style="display: grid; gap: 6px; margin-top: 8px">
                      <div><b class="mono">{{ r.code }}</b><span class="muted" style="margin-left: 8px">{{ r.description }}</span></div>
                      @if (r.schema) { <app-schema-table [doc]="d.spec" [schema]="r.schema" /> }
                    </div>
                  }
                </div>
              </div>
            </article>
          }
        } @else if (store.approved()) {
          <pre class="code" [innerHTML]="json()"></pre>
        } @else {
          <textarea id="raw" spellcheck="false" [(ngModel)]="raw" aria-label="OpenAPI JSON"></textarea>
        }
      }
    }
  `,
})
export class SwaggerTabComponent {
  readonly store = inject(StoreService);
  raw = '';
  readonly ops = computed(() => (this.store.detail()?.spec ? docOperations(this.store.detail()!.spec!) : []));
  readonly json = computed(() => highlightJson(this.store.detail()?.spec ?? {}));
  readonly servers = computed(() => (this.store.detail()?.spec?.['servers'] ?? []).map((s: { url: string }) => s.url).join(', '));

  constructor() {
    effect(() => {
      const spec = this.store.detail()?.spec;
      this.raw = spec ? JSON.stringify(spec, null, 2) : '';
    });
  }

  openJson(): void {
    this.raw = JSON.stringify(this.store.detail()?.spec ?? {}, null, 2);
    this.store.view.set('json');
  }
}

@Component({
  selector: 'app-discuss-tab',
  imports: [FormsModule],
  template: `
    @if (!store.detail()?.spec) {
      <div class="empty">Generate a Swagger file first, then discuss changes with the AI here.</div>
    } @else {
      <div class="chat">
        <div class="chat-top">
          <span class="muted" style="font-size: 14px">
            @if (store.pending()) {
              <b style="color: var(--warn)">{{ store.pending() }} proposal{{ store.pending() === 1 ? '' : 's' }} waiting for your decision</b>
            } @else {
              The AI sees the current Swagger and the source samples.
            }
          </span>
          <span class="actions">
            @if (store.detail()?.canUndo) { <button (click)="store.undo()" [disabled]="!!store.busy()">Undo last change</button> }
            @if (store.discussion().length && !store.busy()) { <button (click)="store.clearDiscussion()">Clear discussion</button> }
          </span>
        </div>
        <div class="log" #log aria-live="polite">
          @for (m of store.discussion(); track m.id) {
            @if (m.role === 'sys') {
              <div class="msg sys"><div class="txt">{{ m.text }}</div></div>
            } @else {
              <div class="msg" [class.user]="m.role === 'user'" [class.ai]="m.role === 'ai'">
                <span class="who">{{ m.role === 'user' ? 'You' : 'AI' }}</span>
                @if (m.id === -2) {
                  <div class="txt"><span class="spin" style="display: inline-block"></span></div>
                } @else if (m.text) {
                  <div class="txt" [innerHTML]="html(m.text)"></div>
                }
                @for (p of m.proposals; track p.id) {
                  <div class="prop" [class]="'prop ' + p.status">
                    <div class="prop-h">
                      <b>{{ p.summary }}</b>
                      @if (p.status === 'pending') {
                        @if (store.approved()) {
                          <span class="pill review">Pending</span>
                        } @else {
                          <span class="actions">
                            <button (click)="store.decide(p.id, false)" [disabled]="!!store.busy()">Reject</button>
                            <button class="primary" (click)="store.decide(p.id, true)" [disabled]="!!store.busy()">Accept</button>
                          </span>
                        }
                      } @else {
                        <span [class]="'pill ' + (p.status === 'accepted' ? 'approved' : 'undocumented')">{{ p.status === 'accepted' ? 'Accepted' : 'Rejected' }}</span>
                      }
                    </div>
                    <div class="scroll">
                      <table>
                        <thead><tr><th>Edit</th><th>Location</th><th>Change</th></tr></thead>
                        <tbody>
                          @for (o of p.ops; track $index) {
                            <tr>
                              <td class="mono">{{ o.op }}</td>
                              <td class="mono" style="overflow-wrap: anywhere">{{ o.path }}</td>
                              <td class="v">
                                @if (o.op !== 'add') { <div class="old">{{ short(o.old) }}</div> }
                                @if (o.op !== 'remove') { <div class="new">{{ short(o.value) }}</div> }
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  </div>
                }
                @if (m.error) { <div class="note bad">{{ m.error }}</div> }
              </div>
            }
          } @empty {
            <div class="empty" style="padding: 24px">Ask the AI why it documented something a certain way, or ask for a change. Changes come back as proposals you accept or reject.</div>
          }
        </div>
        @if (store.approved()) {
          <div class="note">This spec is approved. Reopen it for review to discuss further changes.</div>
        } @else {
          @if (!store.discussion().length) {
            <div class="chips">
              @for (c of chips; track c) { <button (click)="store.send(c)">{{ c }}</button> }
            </div>
          }
          <form class="composer" (ngSubmit)="store.send(store.draft())">
            <textarea
              id="chat-in"
              name="chat"
              #box
              [ngModel]="store.draft()"
              (ngModelChange)="store.draft.set($event)"
              (keydown.enter)="enter($event)"
              [disabled]="store.busy() === 'chat'"
              placeholder="Ask about the spec or describe a change… (Enter to send, Shift+Enter for a new line)"
              aria-label="Message to the AI"
            ></textarea>
            <button class="primary" type="submit" [disabled]="!!store.busy() || !store.draft().trim()">{{ store.busy() === 'chat' ? 'Thinking…' : 'Send' }}</button>
          </form>
        }
      </div>
    }
  `,
})
export class DiscussTabComponent {
  readonly store = inject(StoreService);
  readonly short = short;
  readonly chips = ['Which fields came from the samples?', 'Why is this field nullable?', 'Make the summaries shorter', 'Is anything missing from the 404 response?'];
  private readonly logEl = viewChild<ElementRef<HTMLElement>>('log');
  private readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('box');

  constructor() {
    effect(() => {
      this.store.discussion();
      queueMicrotask(() => {
        const el = this.logEl()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
    effect(() => {
      if (this.store.reviewTab() === 'discuss' && this.store.draft().startsWith('About ')) {
        queueMicrotask(() => {
          const b = this.box()?.nativeElement;
          if (b) {
            b.focus();
            b.setSelectionRange(b.value.length, b.value.length);
          }
        });
      }
    });
  }

  html(t: string): string {
    return chatHtml(t);
  }

  enter(e: Event): void {
    const k = e as KeyboardEvent;
    if (k.shiftKey || k.isComposing) return;
    e.preventDefault();
    this.store.send(this.store.draft());
  }
}

@Component({
  selector: 'app-checks-tab',
  template: `
    @if (store.detail()?.checks; as checks) {
      <div class="checks">
        @for (c of checks; track c.label) {
          <div class="check" [class.ok]="c.ok" [class.no]="!c.ok">
            <span class="i">{{ c.ok ? '✓' : '✕' }}</span>
            <span>{{ c.label }}@if (c.detail) {<small>{{ c.detail }}</small>}</span>
          </div>
        }
      </div>
    } @else {
      <div class="empty">Checks run automatically when the AI returns a Swagger file.</div>
    }
  `,
})
export class ChecksTabComponent {
  readonly store = inject(StoreService);
}
