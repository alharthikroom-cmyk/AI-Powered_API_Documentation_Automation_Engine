import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { applyPatch, getAt } from '../src/spec/json-patch';
import { maskDeep } from '../src/spec/masking';
import { parseFlow, SpecBuilderService } from '../src/spec/spec-builder.service';
import { ValidatorService } from '../src/spec/validator.service';
import { ApigeeExport, SplunkExport } from '../src/sources/source.types';

const apigee: ApigeeExport = JSON.parse(readFileSync(join(__dirname, '../simulation/apigee.json'), 'utf8'));
const splunk: SplunkExport = JSON.parse(readFileSync(join(__dirname, '../simulation/splunk.json'), 'utf8'));
const builder = new SpecBuilderService(new ConfigService({ SAMPLES_PER_OPERATION: 5 }));
const validator = new ValidatorService();
const events = (name: string) => splunk.events.filter(e => e.proxy === name);

describe('parseFlow', () => {
  it('turns Apigee wildcards into named path parameters', () => {
    const f = parseFlow({ name: 'ListContributorEngagements', condition: '(proxy.pathsuffix MatchesPath "/contributors/*/engagements") and (request.verb = "GET")' })!;
    expect(f.path).toBe('/contributors/{contributorId}/engagements');
    expect(f.verb).toBe('get');
    expect('/contributors/1012345678/engagements'.match(f.rx)?.[1]).toBe('1012345678');
  });

  it('returns null for conditions without a path or verb', () => {
    expect(parseFlow({ name: 'x', condition: 'request.verb = "GET"' })).toBeNull();
  });
});

describe('SpecBuilderService', () => {
  it('matches every simulated event to a flow and keeps status codes', () => {
    const p = apigee.proxies.find(x => x.name === 'contributor-inquiry')!;
    const r = builder.build(p, events(p.name), true);
    expect(r.unmatched).toBe(0);
    expect(r.operations.map(o => `${o.method} ${o.path} ${o.samples} ${o.codes.join(',')}`)).toEqual([
      'get /contributors/{contributorId} 3 200,404',
      'get /contributors/{contributorId}/engagements 2 200',
    ]);
    expect(r.spec.paths['/contributors/{contributorId}'].get.body_examples_for_ai).toHaveLength(3);
  });

  it('prefers literal paths over wildcards', () => {
    const p = apigee.proxies.find(x => x.name === 'pension-inquiry')!;
    const r = builder.build(p, events(p.name), false);
    expect(r.operations.find(o => o.path === '/pensions/eligibility')!.samples).toBe(3);
    expect(r.operations.find(o => o.path === '/pensions/{pensionId}')!.samples).toBe(1);
  });

  it('adds no hint fields when a proxy has no logs', () => {
    const p = apigee.proxies.find(x => x.name === 'establishment-registry')!;
    const op = builder.build(p, [], true).spec.paths['/establishments'].get;
    expect(Object.keys(op).filter(k => k.endsWith('_for_ai'))).toEqual([]);
    expect(op.responses).toEqual({ default: { description: '' } });
  });
});

describe('maskDeep', () => {
  it('pseudonymizes identifiers consistently and keeps other values', () => {
    const a = maskDeep({ contributorId: '1012345678', fullNameAr: 'عبدالله', fullNameEn: 'Abdullah', mobileNumber: '0551234567', birthDate: '1988-04-17', status: 'ACTIVE', establishmentName: 'شركة' }) as any;
    const b = maskDeep({ id: '1012345678' }) as any;
    expect(a.contributorId).not.toBe('1012345678');
    expect(a.contributorId).toBe(b.id);
    expect(a.contributorId).toMatch(/^1\d{9}$/);
    expect(a.fullNameAr).toBe('اسم مستعار');
    expect(a.fullNameEn).toBe('Masked Name');
    expect(a.birthDate).toBe('1988-01-01');
    expect(a.status).toBe('ACTIVE');
    expect(a.establishmentName).toBe('شركة');
  });
});

describe('applyPatch', () => {
  const doc = { paths: { '/a/{id}': { get: { summary: 'x', tags: ['t'] } } }, openapi: '3.0.3' };

  it('applies add, replace and remove with escaped pointers', () => {
    const out = applyPatch(doc, [
      { op: 'replace', path: '/paths/~1a~1{id}/get/summary', value: 'Get A' },
      { op: 'add', path: '/paths/~1a~1{id}/get/tags/-', value: 'u' },
      { op: 'remove', path: '/openapi' },
    ]);
    expect(out).toEqual({ paths: { '/a/{id}': { get: { summary: 'Get A', tags: ['t', 'u'] } } } });
    expect(getAt(doc, '/paths/~1a~1{id}/get/summary')).toBe('x');
  });

  it('rejects edits to paths that do not exist', () => {
    expect(() => applyPatch(doc, [{ op: 'replace', path: '/nope/x', value: 1 }])).toThrow('Path not found');
    expect(() => applyPatch(doc, [{ op: 'replace', path: '/paths/missing', value: 1 }])).toThrow('Nothing to replace');
  });
});

describe('ValidatorService', () => {
  const p = apigee.proxies.find(x => x.name === 'contributor-inquiry')!;
  const input = builder.build(p, events(p.name), true).spec;

  it('flags the raw input as unfinished', () => {
    const failing = validator.validate(input, input).filter(c => !c.ok).map(c => c.label);
    expect(failing).toEqual(['All hint fields removed', 'info.description written', 'Every tag has a description', 'Every operation has a description']);
  });

  it('passes a finished spec and catches unresolved refs and changed paths', () => {
    const done = JSON.parse(JSON.stringify(input));
    done.info.description = 'Contributor inquiry.';
    done.tags[0].description = 'Contributor lookups.';
    for (const item of Object.values<any>(done.paths)) {
      for (const op of Object.values<any>(item)) {
        for (const k of Object.keys(op)) if (k.endsWith('_for_ai')) delete op[k];
        op.description = 'Does a thing.';
      }
    }
    expect(validator.validate(done, input).every(c => c.ok)).toBe(true);
    done.paths['/contributors/{contributorId}'].get.responses['200'] = { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } };
    done.paths['/extra'] = { get: { operationId: 'getExtra', description: 'x' } };
    const failing = validator.validate(done, input).filter(c => !c.ok).map(c => c.label);
    expect(failing).toEqual(['Paths and methods unchanged', 'Every $ref resolves']);
  });
});
