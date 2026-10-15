import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PROMPT_TEMPLATE } from '../src/brain/brain.module';
import { DiscussRequest, GosiBrain } from '../src/brain/brain.types';
import { MockBrain } from '../src/brain/mock-brain';
import { ENTITIES } from '../src/registry/entities';
import { RegistryService } from '../src/registry/registry.service';
import { SourcesService } from '../src/sources/sources.service';
import { SpecBuilderService } from '../src/spec/spec-builder.service';
import { ValidatorService } from '../src/spec/validator.service';

class ScriptedBrain extends MockBrain {
  async discuss(req: DiscussRequest): Promise<string> {
    expect(req.system).toContain('CURRENT SPECIFICATION');
    expect(req.messages[req.messages.length - 1].role).toBe('user');
    const r = req.propose({ summary: 'Shorter summary', operations: [{ op: 'replace', path: '/paths/~1contributors~1{contributorId}/get/summary', value: 'Get contributor by ID' }] });
    expect(r.failing_checks_after_change).toEqual([]);
    expect(() => req.propose({ summary: 'bad', operations: [{ op: 'replace', path: '/nope/x', value: 1 }] })).toThrow();
    req.propose({ summary: 'Drop description', operations: [{ op: 'remove', path: '/info/description' }] });
    return 'I proposed two changes.';
  }
}

describe('RegistryService', () => {
  let svc: RegistryService;
  const P = 'contributor-inquiry';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ SIMULATION_DIR: './simulation', SIMULATED_LATENCY_MS: 0 })] }),
        TypeOrmModule.forRoot({ type: 'sqljs', synchronize: true, entities: ENTITIES }),
        TypeOrmModule.forFeature(ENTITIES),
      ],
      providers: [
        SourcesService,
        SpecBuilderService,
        ValidatorService,
        RegistryService,
        { provide: GosiBrain, useClass: ScriptedBrain },
        { provide: PROMPT_TEMPLATE, useValue: 'rules\n## Input OpenAPI Specification\n{{INPUT_SPEC}}' },
      ],
    }).compile();
    await mod.init();
    svc = mod.get(RegistryService);
  });

  it('enforces the step order', async () => {
    await expect(svc.fetchApigee(P)).rejects.toThrow('Start the documentation');
    expect((await svc.start(P)).completed).toBe(1);
    await expect(svc.fetchSplunk(P, true)).rejects.toThrow('Apigee metadata first');
    const a = await svc.fetchApigee(P);
    expect(a.apigee!.managementCall).toBe('GET /v1/organizations/gosi-nonprod/apis/contributor-inquiry/revisions/7/proxies/default');
    expect(a.apigee!.flows.map(f => `${f.method} ${f.path}`)).toEqual(['get /contributors/{contributorId}', 'get /contributors/{contributorId}/engagements']);
    await expect(svc.generate(P)).rejects.toThrow('Splunk samples first');
    const s = await svc.fetchSplunk(P, true);
    expect(s.splunk!.matched).toBe(5);
    expect(s.splunk!.previews[0].response).toMatchObject({ fullNameEn: 'Masked Name' });
  });

  it('runs generate, discuss, accept, reject, undo and approve', async () => {
    const gen = await svc.generate(P);
    expect(gen.specVersion).toBe(1);
    expect(gen.checks!.every(c => c.ok)).toBe(true);

    const disc = await svc.postMessage(P, 'Make the summary shorter');
    const ai = disc.find(m => m.role === 'ai')!;
    expect(ai.text).toBe('I proposed two changes.');
    expect(ai.proposals.map(p => p.summary)).toEqual(['Shorter summary', 'Drop description']);
    expect(ai.proposals[0].ops[0].old).toBe('Get contributor');

    await expect(svc.approve(P, 'Reviewer', '')).rejects.toThrow('pending proposals');

    const accepted = await svc.decide(P, ai.proposals[0].id, true);
    expect(accepted.detail.specVersion).toBe(2);
    expect(accepted.detail.spec!.paths['/contributors/{contributorId}'].get.summary).toBe('Get contributor by ID');

    const rejected = await svc.decide(P, ai.proposals[1].id, false);
    expect(rejected.discussion.filter(m => m.role === 'sys').map(m => m.text)).toEqual([
      'Accepted: Shorter summary · 1 edit applied',
      'Rejected: Drop description',
    ]);

    const undone = await svc.undo(P);
    expect(undone.specVersion).toBe(1);
    expect(undone.canUndo).toBe(false);

    await expect(svc.approve(P, ' ', '')).rejects.toThrow('reviewer name');
    const approved = await svc.approve(P, 'Abdulkarim', 'Looks good');
    expect(approved.status).toBe('approved');
    expect(approved.completed).toBe(6);
    expect(approved.approvedBy).toBe('Abdulkarim');
    await expect(svc.postMessage(P, 'more')).rejects.toThrow('Reopen');
    expect((await svc.reopen(P)).status).toBe('review');
    const r = await svc.restart(P);
    expect([r.completed, r.status, r.spec, r.apigee]).toEqual([1, 'undocumented', null, null]);
  });

  it('accepts a Swagger pasted from claude.ai and an offline draft', async () => {
    const E = 'establishment-registry';
    await svc.start(E);
    await svc.fetchApigee(E);
    await expect(svc.promptText(E)).rejects.toThrow('Splunk samples first');
    await svc.fetchSplunk(E, true);
    expect((await svc.promptText(E)).prompt).toContain('"/establishments"');
    await expect(svc.generateManual(E, 'sorry, here is nothing')).rejects.toThrow('not valid JSON');
    const off = await svc.generate(E, 'offline');
    const pasted = await svc.generateManual(E, 'Here you go:\n```json\n' + JSON.stringify(off.spec) + '\n```');
    expect([pasted.specSource, pasted.specVersion, pasted.completed]).toEqual(['manual', 2, 4]);
  });

  it('refuses to approve a spec that fails validation', async () => {
    await svc.start('pension-inquiry');
    await svc.fetchApigee('pension-inquiry');
    await svc.fetchSplunk('pension-inquiry', true);
    await svc.generate('pension-inquiry');
    const d = await svc.detail('pension-inquiry');
    const broken = { ...d.spec!, info: { ...d.spec!.info, description: '' } };
    await svc.saveManual('pension-inquiry', broken);
    await expect(svc.approve('pension-inquiry', 'Reviewer', '')).rejects.toThrow('failing validation');
  });
});
