import { Body, Controller, Delete, Get, Param, ParseBoolPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SourcesService } from '../sources/sources.service';
import { RegistryService } from './registry.service';

@Controller()
export class RegistryController {
  constructor(
    private readonly registry: RegistryService,
    private readonly sources: SourcesService,
  ) {}

  @Get('health')
  health() {
    const s = this.registry.sourcesView();
    return { status: 'ok', ai: s.brain.mode === 'mock' ? 'offline' : 'connected', model: s.brain.model };
  }

  @Get('sources')
  sourcesView() {
    return this.registry.sourcesView();
  }

  @Post('sources/apigee')
  replaceApigee(@Body() body: unknown) {
    this.sources.setApigee(body);
    return this.registry.sourcesView();
  }

  @Post('sources/splunk')
  replaceSplunk(@Body() body: unknown) {
    this.sources.setSplunk(body);
    return this.registry.sourcesView();
  }

  @Get('proxies')
  list() {
    return this.registry.list();
  }

  @Get('proxies/:name')
  detail(@Param('name') name: string) {
    return this.registry.detail(name);
  }

  @Get('proxies/:name/input')
  input(@Param('name') name: string, @Query('mask', new ParseBoolPipe({ optional: true })) mask?: boolean) {
    return this.registry.input(name, mask ?? true);
  }

  @Post('proxies/:name/start')
  start(@Param('name') name: string) {
    return this.registry.start(name);
  }

  @Post('proxies/:name/steps/apigee')
  apigee(@Param('name') name: string) {
    return this.registry.fetchApigee(name);
  }

  @Post('proxies/:name/steps/splunk')
  splunk(@Param('name') name: string, @Body() body: { mask?: boolean }) {
    return this.registry.fetchSplunk(name, body?.mask !== false);
  }

  @Post('proxies/:name/generate')
  generate(@Param('name') name: string) {
    return this.registry.generate(name);
  }

  @Post('proxies/:name/generate/offline')
  generateOffline(@Param('name') name: string) {
    return this.registry.generate(name, 'offline');
  }

  @Get('proxies/:name/prompt')
  prompt(@Param('name') name: string) {
    return this.registry.promptText(name);
  }

  @Post('proxies/:name/generate/manual')
  generateManual(@Param('name') name: string, @Body() body: { text?: string }) {
    return this.registry.generateManual(name, body?.text ?? '');
  }

  @Post('proxies/:name/restart')
  restart(@Param('name') name: string) {
    return this.registry.restart(name);
  }

  @Put('proxies/:name/spec')
  save(@Param('name') name: string, @Body() body: { spec?: unknown }) {
    return this.registry.saveManual(name, body?.spec);
  }

  @Get('proxies/:name/spec/download')
  async download(@Param('name') name: string, @Res() res: Response) {
    const f = await this.registry.download(name);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
    res.send(f.content);
  }

  @Get('proxies/:name/discussion')
  discussion(@Param('name') name: string) {
    return this.registry.discussion(name);
  }

  @Post('proxies/:name/discussion')
  post(@Param('name') name: string, @Body() body: { message?: string }) {
    return this.registry.postMessage(name, body?.message ?? '');
  }

  @Delete('proxies/:name/discussion')
  clear(@Param('name') name: string) {
    return this.registry.clearDiscussion(name);
  }

  @Post('proxies/:name/proposals/:id/accept')
  accept(@Param('name') name: string, @Param('id') id: string) {
    return this.registry.decide(name, id, true);
  }

  @Post('proxies/:name/proposals/:id/reject')
  reject(@Param('name') name: string, @Param('id') id: string) {
    return this.registry.decide(name, id, false);
  }

  @Post('proxies/:name/undo')
  undo(@Param('name') name: string) {
    return this.registry.undo(name);
  }

  @Post('proxies/:name/approve')
  approve(@Param('name') name: string, @Body() body: { reviewer?: string; note?: string }) {
    return this.registry.approve(name, body?.reviewer ?? '', body?.note ?? '');
  }

  @Post('proxies/:name/reopen')
  reopen(@Param('name') name: string) {
    return this.registry.reopen(name);
  }
}
