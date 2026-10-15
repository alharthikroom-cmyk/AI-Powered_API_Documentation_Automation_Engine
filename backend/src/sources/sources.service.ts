import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { ApigeeExport, ApigeeProxy, SplunkEvent, SplunkExport } from './source.types';

@Injectable()
export class SourcesService implements OnModuleInit {
  private readonly log = new Logger(SourcesService.name);
  private apigee: ApigeeExport = { organization: '', environment: '', proxies: [] };
  private splunk: SplunkExport = { index: '', events: [] };

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const dir = resolve(this.config.get<string>('SIMULATION_DIR', './simulation'));
    this.setApigee(JSON.parse(readFileSync(join(dir, 'apigee.json'), 'utf8')));
    this.setSplunk(JSON.parse(readFileSync(join(dir, 'splunk.json'), 'utf8')));
    this.log.log(`Loaded simulation data from ${dir}: proxies=${this.apigee.proxies.length} events=${this.splunk.events.length}`);
  }

  setApigee(data: unknown): void {
    const d = data as ApigeeExport;
    if (!d || !Array.isArray(d.proxies)) throw new BadRequestException('Expected an Apigee export with a "proxies" array');
    for (const p of d.proxies) {
      if (!p.name || !p.basePath || !Array.isArray(p.flows)) throw new BadRequestException('Each proxy needs name, basePath and flows');
    }
    this.apigee = d;
  }

  setSplunk(data: unknown): void {
    const d = data as SplunkExport;
    if (!d || !Array.isArray(d.events)) throw new BadRequestException('Expected a Splunk export with an "events" array');
    this.splunk = d;
  }

  apigeeExport(): ApigeeExport {
    return this.apigee;
  }

  splunkExport(): SplunkExport {
    return this.splunk;
  }

  proxies(): ApigeeProxy[] {
    return this.apigee.proxies;
  }

  proxy(name: string): ApigeeProxy | undefined {
    return this.apigee.proxies.find(p => p.name === name);
  }

  events(proxyName: string): SplunkEvent[] {
    return this.splunk.events.filter(e => e.proxy === proxyName);
  }
}
