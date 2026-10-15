import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { MessageView, OpenApiDoc, ProxyDetail, ProxySummary, ReviewTab, SourcesView, StepNo } from './models';

type Busy = 'start' | 'apigee' | 'splunk' | 'generate' | 'chat' | 'action' | null;

const REVIEWER_KEY = 'ade.reviewer';
const OUTDATED = 'The backend is running an older build. Stop it, run "npm run build" in the project folder, then "npm start" again.';

function readReviewer(): string {
  try {
    return localStorage.getItem(REVIEWER_KEY) ?? '';
  } catch {
    return '';
  }
}

@Injectable({ providedIn: 'root' })
export class StoreService {
  private readonly api = inject(ApiService);

  readonly sources = signal<SourcesView | null>(null);
  readonly proxies = signal<ProxySummary[]>([]);
  readonly selected = signal<string | null>(null);
  readonly detail = signal<ProxyDetail | null>(null);
  readonly input = signal<OpenApiDoc | null>(null);
  readonly discussion = signal<MessageView[]>([]);
  readonly mask = signal(true);
  readonly step = signal<StepNo>(1);
  readonly reviewTab = signal<ReviewTab>('swagger');
  readonly view = signal<'docs' | 'json'>('docs');
  readonly busy = signal<Busy>(null);
  readonly error = signal<string | null>(null);
  readonly draft = signal('');
  readonly reviewer = signal(readReviewer());
  readonly note = signal('');

  readonly completed = computed(() => this.detail()?.completed ?? 0);
  readonly pending = computed(() => this.discussion().reduce((n, m) => n + m.proposals.filter(p => p.status === 'pending').length, 0));
  readonly approved = computed(() => this.detail()?.status === 'approved');
  readonly allChecksOk = computed(() => !!this.detail()?.checks?.length && this.detail()!.checks!.every(c => c.ok));
  readonly readyToSubmit = computed(() => !!this.detail()?.spec && this.allChecksOk() && !this.pending() && !this.busy() && !this.approved());
  readonly offline = computed(() => this.sources()?.brain.mode === 'mock');

  reachable(n: number): boolean {
    const c = this.completed();
    return c >= 4 ? n <= 6 : n <= c + 1;
  }

  done(n: number): boolean {
    const c = this.completed();
    return n <= 4 ? c >= n : c >= 6;
  }

  async init(): Promise<void> {
    await this.run(null, async () => {
      const sources = await this.api.sources();
      this.sources.set(sources);
      if (!sources.splunk?.sourcetype) throw new Error(OUTDATED);
      await this.refreshList();
      const first = this.proxies()[0]?.name;
      if (first) await this.select(first);
    });
  }

  async select(name: string): Promise<void> {
    this.selected.set(name);
    this.draft.set('');
    this.note.set('');
    this.error.set(null);
    await this.run(null, async () => {
      const [detail, discussion] = await Promise.all([this.api.detail(name), this.api.discussion(name)]);
      if (this.selected() !== name) return;
      if (typeof detail.completed !== 'number') throw new Error(OUTDATED);
      this.apply(detail);
      this.discussion.set(discussion);
      this.mask.set(detail.mask);
      this.step.set(this.nextStep(detail.completed));
      this.reviewTab.set('swagger');
    });
  }

  goto(n: number): void {
    if (this.reachable(n)) {
      this.error.set(null);
      this.step.set(n as StepNo);
    }
  }

  async start(): Promise<void> {
    await this.act('start', n => this.api.start(n), 2);
  }

  async fetchApigee(): Promise<void> {
    await this.act('apigee', n => this.api.fetchApigee(n));
  }

  async fetchSplunk(): Promise<void> {
    await this.act('splunk', n => this.api.fetchSplunk(n, this.mask()));
    const name = this.selected();
    if (name) await this.run(null, async () => this.input.set(await this.api.input(name, this.mask())));
  }

  async generate(): Promise<void> {
    const name = this.selected();
    if (!name) return;
    await this.run('generate', async () => {
      this.apply(await this.api.generate(name));
      this.discussion.set(await this.api.discussion(name));
      this.view.set('docs');
      this.reviewTab.set('swagger');
      this.step.set(5);
      await this.refreshList();
    });
  }

  async generateOffline(): Promise<void> {
    await this.generateWith(n => this.api.generateOffline(n));
  }

  async generateManual(text: string): Promise<boolean> {
    if (!text.trim()) {
      this.error.set('Paste the reply from claude.ai first.');
      return false;
    }
    await this.generateWith(n => this.api.generateManual(n, text));
    return !this.error();
  }

  async copyPrompt(): Promise<boolean> {
    const name = this.selected();
    if (!name) return false;
    try {
      const { prompt } = await this.api.prompt(name);
      await navigator.clipboard.writeText(prompt);
      this.error.set(null);
      return true;
    } catch (e) {
      this.error.set(e instanceof HttpErrorResponse ? this.message(e) : 'The browser blocked copying. Use "Show exactly what is sent to the AI" and copy from there.');
      return false;
    }
  }

  private async generateWith(call: (name: string) => Promise<ProxyDetail>): Promise<void> {
    const name = this.selected();
    if (!name) return;
    await this.run('generate', async () => {
      this.apply(await call(name));
      this.discussion.set(await this.api.discussion(name));
      this.view.set('docs');
      this.reviewTab.set('swagger');
      this.step.set(5);
      await this.refreshList();
    });
  }

  async restart(): Promise<void> {
    await this.act('action', n => this.api.restart(n), 2);
    this.discussion.set([]);
    this.input.set(null);
  }

  async loadInput(): Promise<void> {
    const name = this.selected();
    if (name && !this.input()) await this.run(null, async () => this.input.set(await this.api.input(name, this.mask())));
  }

  async saveJson(text: string): Promise<void> {
    const name = this.selected();
    if (!name) return;
    let spec: OpenApiDoc;
    try {
      spec = JSON.parse(text);
    } catch (e) {
      this.error.set(`The JSON has a syntax error: ${(e as Error).message}`);
      return;
    }
    await this.run('action', async () => this.apply(await this.api.saveSpec(name, spec)));
  }

  async send(text: string): Promise<void> {
    const name = this.selected();
    const message = text.trim();
    if (!name || !message || this.busy()) return;
    const stamp = new Date().toISOString();
    this.discussion.update(d => [
      ...d,
      { id: -1, role: 'user', text: message, error: null, createdAt: stamp, proposals: [] },
      { id: -2, role: 'ai', text: '', error: null, createdAt: stamp, proposals: [] },
    ]);
    this.draft.set('');
    await this.run('chat', async () => {
      this.discussion.set(await this.api.send(name, message));
      await this.refreshList();
    });
    if (this.discussion().some(m => m.id < 0)) {
      this.discussion.update(d => d.filter(m => m.id >= 0));
      this.draft.set(message);
    }
  }

  async decide(id: string, accept: boolean): Promise<void> {
    const name = this.selected();
    if (!name) return;
    await this.run('action', async () => {
      const r = await this.api.decide(name, id, accept);
      this.apply(r.detail);
      this.discussion.set(r.discussion);
      await this.refreshList();
    });
  }

  async clearDiscussion(): Promise<void> {
    const name = this.selected();
    if (!name) return;
    await this.run('action', async () => {
      this.discussion.set(await this.api.clearDiscussion(name));
      await this.refreshList();
    });
  }

  async undo(): Promise<void> {
    const name = this.selected();
    if (!name) return;
    await this.run('action', async () => {
      this.apply(await this.api.undo(name));
      this.discussion.set(await this.api.discussion(name));
    });
  }

  async approve(): Promise<void> {
    const name = this.selected();
    const who = this.reviewer().trim();
    if (!name) return;
    if (!who) {
      this.error.set('Enter the reviewer name before submitting.');
      return;
    }
    try {
      localStorage.setItem(REVIEWER_KEY, who);
    } catch {}
    await this.run('action', async () => {
      this.apply(await this.api.approve(name, who, this.note()));
      await this.refreshList();
    });
  }

  async reopen(): Promise<void> {
    await this.act('action', n => this.api.reopen(n), 5);
  }

  async replaceSource(kind: 'apigee' | 'splunk', file: File): Promise<void> {
    await this.run('action', async () => {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error(`${file.name} is not valid JSON`);
      }
      this.sources.set(await this.api.replaceSource(kind, data));
      await this.refreshList();
      const keep = this.proxies().find(p => p.name === this.selected())?.name ?? this.proxies()[0]?.name;
      if (keep) await this.select(keep);
      else {
        this.selected.set(null);
        this.detail.set(null);
      }
    });
  }

  downloadUrl(): string | null {
    const name = this.selected();
    return name ? this.api.downloadUrl(name) : null;
  }

  ask(op: string): void {
    this.draft.set(`About ${op}: `);
    this.reviewTab.set('discuss');
  }

  private nextStep(completed: number): StepNo {
    if (completed >= 6) return 6;
    if (completed >= 4) return 5;
    return (completed + 1) as StepNo;
  }

  private apply(d: ProxyDetail): void {
    this.detail.set(d);
    this.mask.set(d.mask);
  }

  private async act(kind: Busy, call: (name: string) => Promise<ProxyDetail>, then?: StepNo): Promise<void> {
    const name = this.selected();
    if (!name) return;
    await this.run(kind, async () => {
      this.apply(await call(name));
      if (then) this.step.set(then);
      await this.refreshList();
    });
  }

  private async refreshList(): Promise<void> {
    this.proxies.set(await this.api.proxies());
  }

  private async run(kind: Busy, fn: () => Promise<void>): Promise<void> {
    if (kind) this.busy.set(kind);
    this.error.set(null);
    try {
      await fn();
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      if (kind) this.busy.set(null);
    }
  }

  private message(e: unknown): string {
    if (e instanceof HttpErrorResponse) {
      if (e.status === 0 || e.status === 504 || (e.status >= 500 && typeof e.error !== 'object')) {
        return 'The backend is not reachable. Start it with "npm start" in the backend folder.';
      }
      return e.error?.message ?? `Request failed (${e.status})`;
    }
    return (e as Error)?.message ?? 'Something went wrong';
  }
}
