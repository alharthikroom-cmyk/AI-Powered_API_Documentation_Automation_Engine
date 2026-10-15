import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { PROMPT_TEMPLATE } from '../brain/brain.module';
import { BrainError, ChatTurn, GosiBrain, ProposeInput, parseSpecText } from '../brain/brain.types';
import { chatGuide } from '../brain/chat-guide';
import { MockBrain } from '../brain/mock-brain';
import { SourcesService } from '../sources/sources.service';
import { ApigeeProxy } from '../sources/source.types';
import { applyPatch, getAt } from '../spec/json-patch';
import { Check, OpenApiDoc, PatchOp } from '../spec/openapi.types';
import { parseFlow, SpecBuilderService } from '../spec/spec-builder.service';
import { ValidatorService } from '../spec/validator.service';
import {
  ApiRegistryEntity,
  ApiSpecEntity,
  DiscussionMessageEntity,
  ProposalEntity,
  SpecSource,
  ValidationLogEntity,
} from './entities';
import { ApigeeStepView, MessageView, ProxyDetail, ProxySummary, SamplePreview, SourcesView, SplunkStepView } from './registry.types';

const now = () => new Date().toISOString();
const OPS = ['add', 'replace', 'remove'];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const splunkQuery = (index: string, sourcetype: string, proxy: string) =>
  `search index=${index} sourcetype="${sourcetype}" proxy="${proxy}" earliest=-7d | head 500`;

export const STEP = { started: 1, apigee: 2, splunk: 3, generated: 4, approved: 6 } as const;

@Injectable()
export class RegistryService {
  private readonly log = new Logger(RegistryService.name);
  private readonly busy = new Set<string>();
  private readonly latency: number;
  private readonly offline = new MockBrain();

  constructor(
    config: ConfigService,
    private readonly sources: SourcesService,
    private readonly builder: SpecBuilderService,
    private readonly validator: ValidatorService,
    private readonly brain: GosiBrain,
    @Inject(PROMPT_TEMPLATE) private readonly prompt: string,
    @InjectRepository(ApiRegistryEntity) private readonly registry: Repository<ApiRegistryEntity>,
    @InjectRepository(ApiSpecEntity) private readonly specs: Repository<ApiSpecEntity>,
    @InjectRepository(ValidationLogEntity) private readonly logs: Repository<ValidationLogEntity>,
    @InjectRepository(DiscussionMessageEntity) private readonly messages: Repository<DiscussionMessageEntity>,
    @InjectRepository(ProposalEntity) private readonly proposals: Repository<ProposalEntity>,
  ) {
    this.latency = Math.max(0, Number(config.get('SIMULATED_LATENCY_MS', 900)));
  }

  sourcesView(): SourcesView {
    const a = this.sources.apigeeExport();
    const s = this.sources.splunkExport();
    return {
      apigee: { organization: a.organization, environment: a.environment, proxies: a.proxies.length },
      splunk: { index: s.index, sourcetype: s.sourcetype ?? 'apigee:messagelog', events: s.events.length },
      brain: { mode: this.brain.mode, model: this.brain.label },
    };
  }

  async list(): Promise<ProxySummary[]> {
    const rows = await this.registry.find();
    const pending = await this.proposals.find({ where: { status: 'pending' } });
    return this.sources.proxies().map(p => this.summary(p, rows.find(r => r.name === p.name), pending.filter(x => x.apiName === p.name).length));
  }

  async detail(name: string): Promise<ProxyDetail> {
    const p = this.proxy(name);
    const row = await this.entry(name);
    const spec = row.currentSpecId ? await this.specs.findOneBy({ id: row.currentSpecId }) : null;
    const checks = spec ? await this.logs.find({ where: { specId: spec.id }, order: { id: 'ASC' } }) : null;
    const older = spec ? await this.specs.count({ where: { apiName: name, id: LessThan(spec.id) } }) : 0;
    const pending = await this.proposals.count({ where: { apiName: name, status: 'pending' } });
    const acceptedChanges = await this.proposals.count({ where: { apiName: name, status: 'accepted' } });
    return {
      ...this.summary(p, row, pending),
      virtualHost: p.virtualHost,
      targetServer: p.targetServer ?? null,
      mask: row.mask,
      startedAt: row.startedAt,
      apigee: row.completed >= STEP.apigee ? this.apigeeView(p, row.apigeeAt!) : null,
      splunk: row.completed >= STEP.splunk ? this.splunkView(p, row.splunkAt!, row.mask) : null,
      spec: spec ? JSON.parse(spec.content) : null,
      specVersion: spec?.version ?? null,
      specSource: spec?.source ?? null,
      canUndo: older > 0 && row.status !== 'approved',
      checks: checks ? checks.map(c => ({ ok: c.ok, label: c.label, detail: c.errorMessage })) : null,
      acceptedChanges,
      approvedAt: row.approvedAt,
      approvedBy: row.approvedBy,
      approvalNote: row.approvalNote,
    };
  }

  input(name: string, mask: boolean): OpenApiDoc {
    return this.builder.build(this.proxy(name), this.sources.events(name), mask).spec;
  }

  async start(name: string): Promise<ProxyDetail> {
    const row = await this.entry(name);
    if (row.completed < STEP.started) {
      row.completed = STEP.started;
      row.startedAt = now();
      row.updatedAt = now();
      await this.registry.save(row);
      this.log.log(`workflow started proxy=${name}`);
    }
    return this.detail(name);
  }

  async fetchApigee(name: string): Promise<ProxyDetail> {
    const row = await this.entry(name);
    this.assertEditable(row);
    this.requireStep(row, STEP.started, 'Start the documentation for this API first');
    await sleep(this.latency);
    row.apigeeAt = now();
    row.completed = Math.max(row.completed, STEP.apigee);
    row.updatedAt = now();
    await this.registry.save(row);
    this.log.log(`apigee metadata fetched proxy=${name}`);
    return this.detail(name);
  }

  async fetchSplunk(name: string, mask: boolean): Promise<ProxyDetail> {
    const row = await this.entry(name);
    this.assertEditable(row);
    this.requireStep(row, STEP.apigee, 'Fetch the Apigee metadata first');
    await sleep(this.latency);
    row.mask = mask;
    row.splunkAt = now();
    row.completed = Math.max(row.completed, STEP.splunk);
    row.updatedAt = now();
    await this.registry.save(row);
    this.log.log(`splunk samples pulled proxy=${name} mask=${mask}`);
    return this.detail(name);
  }

  async generate(name: string, via: 'ai' | 'offline' = 'ai'): Promise<ProxyDetail> {
    const p = this.proxy(name);
    const row = await this.entry(name);
    this.assertEditable(row);
    this.requireStep(row, STEP.splunk, 'Pull the Splunk samples first');
    this.lock(name);
    try {
      const input = this.builder.build(p, this.sources.events(name), row.mask).spec;
      const brain = via === 'offline' ? this.offline : this.brain;
      const text = await brain.generate(name, input, this.fullPrompt(input));
      await this.storeGenerated(row, parseSpecText(text), input, brain.mode);
      return this.detail(name);
    } finally {
      this.busy.delete(name);
    }
  }

  async promptText(name: string): Promise<{ prompt: string }> {
    const p = this.proxy(name);
    const row = await this.entry(name);
    this.requireStep(row, STEP.splunk, 'Pull the Splunk samples first');
    return { prompt: this.fullPrompt(this.builder.build(p, this.sources.events(name), row.mask).spec) };
  }

  async generateManual(name: string, text: string): Promise<ProxyDetail> {
    const p = this.proxy(name);
    const row = await this.entry(name);
    this.assertEditable(row);
    this.requireStep(row, STEP.splunk, 'Pull the Splunk samples first');
    if (!String(text ?? '').trim()) throw new BadRequestException('Paste the Swagger JSON first');
    let out: OpenApiDoc;
    try {
      out = parseSpecText(String(text));
    } catch {
      throw new BadRequestException('The pasted text is not valid JSON. Copy the whole reply from claude.ai and try again');
    }
    const input = this.builder.build(p, this.sources.events(name), row.mask).spec;
    await this.storeGenerated(row, out, input, 'manual');
    return this.detail(name);
  }

  private fullPrompt(input: OpenApiDoc): string {
    return this.prompt.replace('{{INPUT_SPEC}}', JSON.stringify(input, null, 2));
  }

  private async storeGenerated(row: ApiRegistryEntity, out: OpenApiDoc, input: OpenApiDoc, source: SpecSource): Promise<void> {
    const hadSpec = !!row.currentSpecId;
    await this.saveVersion(row, out, input, source);
    const stale = await this.proposals.find({ where: { apiName: row.name, status: 'pending' } });
    if (stale.length) await this.proposals.update({ id: In(stale.map(s => s.id)) }, { status: 'rejected' });
    if (hadSpec && (await this.messages.countBy({ apiName: row.name }))) {
      await this.sys(row.name, 'Swagger regenerated from scratch. Earlier accepted changes are not in this version.');
    }
  }

  async restart(name: string): Promise<ProxyDetail> {
    const row = await this.entry(name);
    if (this.busy.has(name)) throw new ConflictException('The AI is still working on this API');
    await this.proposals.delete({ apiName: name });
    await this.messages.delete({ apiName: name });
    Object.assign(row, {
      status: 'undocumented',
      completed: STEP.started,
      startedAt: now(),
      apigeeAt: null,
      splunkAt: null,
      currentSpecId: null,
      approvedAt: null,
      approvedBy: null,
      approvalNote: null,
      updatedAt: now(),
    });
    await this.registry.save(row);
    this.log.log(`workflow restarted proxy=${name}`);
    return this.detail(name);
  }

  async saveManual(name: string, spec: unknown): Promise<ProxyDetail> {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new BadRequestException('Body must contain a "spec" object');
    const row = await this.entry(name);
    this.assertEditable(row);
    const current = await this.current(row);
    await this.saveVersion(row, spec as OpenApiDoc, JSON.parse(current.inputContent), 'manual');
    return this.detail(name);
  }

  async discussion(name: string): Promise<MessageView[]> {
    this.proxy(name);
    const msgs = await this.messages.find({ where: { apiName: name }, order: { id: 'ASC' } });
    const props = await this.proposals.find({ where: { apiName: name }, order: { createdAt: 'ASC' } });
    return msgs.map(m => ({
      id: m.id,
      role: m.role,
      text: m.text,
      error: m.error,
      createdAt: m.createdAt,
      proposals: props.filter(p => p.messageId === m.id).map(p => ({ id: p.id, summary: p.summary, ops: p.ops, status: p.status })),
    }));
  }

  async clearDiscussion(name: string): Promise<MessageView[]> {
    this.proxy(name);
    if (this.busy.has(name)) throw new ConflictException('The AI is still working on this API');
    await this.proposals.delete({ apiName: name });
    await this.messages.delete({ apiName: name });
    return [];
  }

  async postMessage(name: string, text: string): Promise<MessageView[]> {
    const message = String(text ?? '').trim();
    if (!message) throw new BadRequestException('Message is empty');
    if (message.length > 4000) throw new BadRequestException('Message is too long');
    const row = await this.entry(name);
    if (row.status === 'approved') throw new ConflictException('Reopen the spec for review before discussing changes');
    const current = await this.current(row);
    this.lock(name);
    try {
      await this.messages.save(this.messages.create({ apiName: name, role: 'user', text: message, error: null, createdAt: now() }));
      const history = await this.history(name);
      const spec: OpenApiDoc = JSON.parse(current.content);
      const input: OpenApiDoc = JSON.parse(current.inputContent);
      const drafted: { summary: string; ops: (PatchOp & { old?: unknown })[] }[] = [];

      const propose = (raw: ProposeInput): Record<string, unknown> => {
        const ops = (Array.isArray(raw?.operations) ? raw.operations : []) as PatchOp[];
        if (!ops.length) throw new Error('operations is empty');
        for (const o of ops) {
          if (!OPS.includes(o.op) || typeof o.path !== 'string') throw new Error('Each operation needs op (add, replace, remove) and a string path');
        }
        const base = drafted.reduce<OpenApiDoc>((d, x) => applyPatch(d, x.ops), spec);
        const next = applyPatch(base, ops);
        const failing = this.validator.validate(next, input).filter(c => !c.ok).map(c => c.label + (c.detail ? ` (${c.detail})` : ''));
        drafted.push({ summary: String(raw.summary || 'Proposed change').slice(0, 300), ops: ops.map(o => ({ op: o.op, path: o.path, value: o.value, old: getAt(base, o.path) })) });
        return { status: 'shown_to_reviewer', operations: ops.length, failing_checks_after_change: failing };
      };

      let reply = '';
      let error: string | null = null;
      try {
        const system = `${chatGuide(this.prompt)}\n=== SOURCE INPUT (base spec with sample hint fields) ===\n${current.inputContent}\n\n=== CURRENT SPECIFICATION (version ${current.version}) ===\n${current.content}`;
        reply = await this.brain.discuss({ proxy: name, system, messages: history, propose });
      } catch (e) {
        error = e instanceof BrainError ? e.message : 'The AI request failed';
        if (!(e instanceof BrainError)) this.log.error(`discussion failed proxy=${name}`, (e as Error)?.stack);
      }
      if (!reply.trim() && !drafted.length && !error) reply = 'No reply was returned.';
      const ai = await this.messages.save(this.messages.create({ apiName: name, role: 'ai', text: reply, error, createdAt: now() }));
      for (const d of drafted) {
        await this.proposals.save(this.proposals.create({ apiName: name, messageId: ai.id, summary: d.summary, ops: d.ops, status: 'pending', createdAt: now() }));
      }
      return this.discussion(name);
    } finally {
      this.busy.delete(name);
    }
  }

  async decide(name: string, proposalId: string, accept: boolean): Promise<{ detail: ProxyDetail; discussion: MessageView[] }> {
    const row = await this.entry(name);
    this.assertEditable(row);
    const prop = await this.proposals.findOneBy({ id: proposalId, apiName: name });
    if (!prop) throw new NotFoundException('Proposal not found');
    if (prop.status !== 'pending') throw new ConflictException('This proposal was already decided');
    if (!accept) {
      prop.status = 'rejected';
      await this.proposals.save(prop);
      await this.sys(name, `Rejected: ${prop.summary}`);
    } else {
      const current = await this.current(row);
      try {
        const next = applyPatch(JSON.parse(current.content), prop.ops.map(({ op, path, value }) => ({ op, path, value })));
        await this.saveVersion(row, next, JSON.parse(current.inputContent), 'patch');
        prop.status = 'accepted';
        await this.proposals.save(prop);
        await this.sys(name, `Accepted: ${prop.summary} · ${prop.ops.length} edit${prop.ops.length === 1 ? '' : 's'} applied`);
      } catch (e) {
        prop.status = 'rejected';
        await this.proposals.save(prop);
        await this.sys(name, `Could not apply "${prop.summary}": ${(e as Error).message}. Ask the AI to propose it again.`);
      }
    }
    return { detail: await this.detail(name), discussion: await this.discussion(name) };
  }

  async undo(name: string): Promise<ProxyDetail> {
    const row = await this.entry(name);
    this.assertEditable(row);
    const current = await this.current(row);
    const prev = await this.specs.findOne({ where: { apiName: name, id: LessThan(current.id) }, order: { id: 'DESC' } });
    if (!prev) throw new ConflictException('There is no earlier version to restore');
    row.currentSpecId = prev.id;
    row.updatedAt = now();
    await this.registry.save(row);
    await this.logs.delete({ specId: current.id });
    await this.specs.delete({ id: current.id });
    await this.sys(name, `Undid version ${current.version}, back to version ${prev.version}`);
    this.log.log(`undo proxy=${name} removedVersion=${current.version} currentVersion=${prev.version}`);
    return this.detail(name);
  }

  async approve(name: string, reviewer: string, note: string): Promise<ProxyDetail> {
    const who = String(reviewer ?? '').trim();
    const memo = String(note ?? '').trim();
    if (!who) throw new BadRequestException('Enter the reviewer name');
    if (who.length > 100) throw new BadRequestException('Reviewer name is too long');
    if (memo.length > 1000) throw new BadRequestException('Note is too long');
    const row = await this.entry(name);
    if (row.status === 'approved') return this.detail(name);
    const current = await this.current(row);
    const checks = await this.logs.find({ where: { specId: current.id } });
    if (checks.some(c => !c.ok)) throw new ConflictException('Fix the failing validation checks before approving');
    if (await this.proposals.count({ where: { apiName: name, status: 'pending' } })) {
      throw new ConflictException('Accept or reject the pending proposals before approving');
    }
    if (this.busy.has(name)) throw new ConflictException('The AI is still working on this API');
    Object.assign(row, { status: 'approved', completed: STEP.approved, approvedAt: now(), approvedBy: who, approvalNote: memo || null, updatedAt: now() });
    await this.registry.save(row);
    this.log.log(`approved proxy=${name} specId=${current.id} version=${current.version}`);
    return this.detail(name);
  }

  async reopen(name: string): Promise<ProxyDetail> {
    const row = await this.entry(name);
    if (row.status !== 'approved') return this.detail(name);
    Object.assign(row, { status: 'review', completed: STEP.generated, approvedAt: null, approvedBy: null, approvalNote: null, updatedAt: now() });
    await this.registry.save(row);
    return this.detail(name);
  }

  async download(name: string): Promise<{ filename: string; content: string }> {
    const p = this.proxy(name);
    const row = await this.entry(name);
    const current = await this.current(row);
    return { filename: `${p.name}-rev${p.revision}-v${current.version}.openapi.json`, content: current.content };
  }

  private summary(p: ApigeeProxy, row: ApiRegistryEntity | undefined, pending: number): ProxySummary {
    return {
      name: p.name,
      basePath: p.basePath,
      revision: p.revision,
      flows: p.flows.length,
      events: this.sources.events(p.name).length,
      status: row?.status ?? 'undocumented',
      completed: row?.completed ?? 0,
      pending,
    };
  }

  private proxy(name: string): ApigeeProxy {
    const p = this.sources.proxy(name);
    if (!p) throw new NotFoundException('API proxy not found');
    return p;
  }

  private async entry(name: string): Promise<ApiRegistryEntity> {
    this.proxy(name);
    const found = await this.registry.findOneBy({ name });
    if (found) return found;
    return this.registry.save(
      this.registry.create({
        name,
        status: 'undocumented',
        currentSpecId: null,
        mask: true,
        completed: 0,
        startedAt: null,
        apigeeAt: null,
        splunkAt: null,
        approvedAt: null,
        approvedBy: null,
        approvalNote: null,
        updatedAt: now(),
      }),
    );
  }

  private async current(row: ApiRegistryEntity): Promise<ApiSpecEntity> {
    const spec = row.currentSpecId ? await this.specs.findOneBy({ id: row.currentSpecId }) : null;
    if (!spec) throw new ConflictException('Generate a Swagger file first');
    return spec;
  }

  private assertEditable(row: ApiRegistryEntity): void {
    if (row.status === 'approved') throw new ConflictException('Reopen the spec for review before changing it');
    if (this.busy.has(row.name)) throw new ConflictException('The AI is still working on this API');
  }

  private requireStep(row: ApiRegistryEntity, step: number, message: string): void {
    if (row.completed < step) throw new ConflictException(message);
  }

  private apigeeView(p: ApigeeProxy, fetchedAt: string): ApigeeStepView {
    const a = this.sources.apigeeExport();
    const flows = p.flows.map(f => ({ f, parsed: parseFlow(f) }));
    return {
      fetchedAt,
      organization: a.organization,
      environment: a.environment,
      managementCall: `GET /v1/organizations/${a.organization}/apis/${p.name}/revisions/${p.revision}/proxies/default`,
      proxy: { name: p.name, revision: p.revision, basePath: p.basePath, virtualHost: p.virtualHost, targetServer: p.targetServer ?? null, owner: p.owner ?? null },
      flows: flows.filter(x => x.parsed).map(({ f, parsed }) => ({ name: f.name, condition: f.condition, method: parsed!.verb, path: parsed!.path, params: parsed!.params })),
      skipped: flows.filter(x => !x.parsed).map(x => x.f.name),
    };
  }

  private splunkView(p: ApigeeProxy, fetchedAt: string, mask: boolean): SplunkStepView {
    const s = this.sources.splunkExport();
    const events = this.sources.events(p.name);
    const build = this.builder.build(p, events, mask);
    const previews: SamplePreview[] = [];
    for (const o of build.operations) {
      const op = build.spec.paths[o.path]?.[o.method];
      const body = op?.body_examples_for_ai?.[0];
      if (!body) continue;
      previews.push({
        method: o.method,
        path: o.path,
        status: body.status ?? null,
        pathParams: op.path_examples_for_ai?.[0] ?? null,
        query: op.query_parameters_examples_for_ai?.[0] ?? null,
        request: body.request ?? null,
        response: body.response ?? null,
      });
    }
    const sourcetype = s.sourcetype ?? 'apigee:messagelog';
    return {
      fetchedAt,
      index: s.index,
      sourcetype,
      query: splunkQuery(s.index, sourcetype, p.name),
      totalEvents: build.totalEvents,
      matched: build.totalEvents - build.unmatched,
      unmatched: build.unmatched,
      mask,
      operations: build.operations,
      previews,
    };
  }

  private lock(name: string): void {
    if (this.busy.has(name)) throw new ConflictException('The AI is still working on this API');
    this.busy.add(name);
  }

  private async saveVersion(row: ApiRegistryEntity, spec: OpenApiDoc, input: OpenApiDoc, source: SpecSource): Promise<void> {
    const checks: Check[] = this.validator.validate(spec, input);
    const last = await this.specs.findOne({ where: { apiName: row.name }, order: { version: 'DESC' } });
    const saved = await this.specs.save(
      this.specs.create({
        apiName: row.name,
        version: (last?.version ?? 0) + 1,
        source,
        content: JSON.stringify(spec, null, 2),
        inputContent: JSON.stringify(input),
        isValid: checks.every(c => c.ok),
        createdAt: now(),
      }),
    );
    await this.logs.save(checks.map(c => this.logs.create({ specId: saved.id, label: c.label, ok: c.ok, errorMessage: c.detail, validatedAt: now() })));
    row.currentSpecId = saved.id;
    row.status = 'review';
    row.completed = Math.max(row.completed, STEP.generated);
    row.updatedAt = now();
    await this.registry.save(row);
    this.log.log(`spec saved proxy=${row.name} version=${saved.version} source=${source} valid=${saved.isValid}`);
  }

  private async sys(name: string, text: string): Promise<void> {
    await this.messages.save(this.messages.create({ apiName: name, role: 'sys', text, error: null, createdAt: now() }));
  }

  private async history(name: string): Promise<ChatTurn[]> {
    const msgs = await this.messages.find({ where: { apiName: name }, order: { id: 'ASC' } });
    const props = await this.proposals.find({ where: { apiName: name } });
    const out: ChatTurn[] = [];
    for (const m of msgs) {
      if (m.role === 'sys') continue;
      let c = m.text || '';
      const mine = props.filter(p => p.messageId === m.id);
      if (m.role === 'ai' && mine.length) c += '\n' + mine.map(p => `[Proposed: ${p.summary} — ${p.status}]`).join('\n');
      if (m.role === 'ai' && m.error && !c.trim()) c = '(reply failed)';
      if (!c.trim()) continue;
      const role = m.role === 'user' ? 'user' : 'assistant';
      const last = out[out.length - 1];
      if (last && last.role === role) last.content += '\n\n' + c;
      else out.push({ role, content: c });
    }
    if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: 'Start of review.' });
    return out;
  }
}
