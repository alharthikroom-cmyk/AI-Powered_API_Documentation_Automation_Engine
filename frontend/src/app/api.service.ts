import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MessageView, OpenApiDoc, ProxyDetail, ProxySummary, SourcesView } from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  private p(name: string): string {
    return `${this.base}/proxies/${encodeURIComponent(name)}`;
  }

  sources() {
    return firstValueFrom(this.http.get<SourcesView>(`${this.base}/sources`));
  }

  replaceSource(kind: 'apigee' | 'splunk', data: unknown) {
    return firstValueFrom(this.http.post<SourcesView>(`${this.base}/sources/${kind}`, data));
  }

  proxies() {
    return firstValueFrom(this.http.get<ProxySummary[]>(`${this.base}/proxies`));
  }

  detail(name: string) {
    return firstValueFrom(this.http.get<ProxyDetail>(this.p(name)));
  }

  input(name: string, mask: boolean) {
    return firstValueFrom(this.http.get<OpenApiDoc>(`${this.p(name)}/input`, { params: { mask } }));
  }

  start(name: string) {
    return firstValueFrom(this.http.post<ProxyDetail>(`${this.p(name)}/start`, {}));
  }

  fetchApigee(name: string) {
    return firstValueFrom(this.http.post<ProxyDetail>(`${this.p(name)}/steps/apigee`, {}));
  }

  fetchSplunk(name: string, mask: boolean) {
    return firstValueFrom(this.http.post<ProxyDetail>(`${this.p(name)}/steps/splunk`, { mask }));
  }

  generate(name: string) {
    return firstValueFrom(this.http.post<ProxyDetail>(`${this.p(name)}/generate`, {}));
  }

  generateOffline(name: string) {
    return firstValueFrom(this.http.post<ProxyDetail>(`${this.p(name)}/generate/offline`, {}));
  }

  prompt(name: string) {
    return firstValueFrom(this.http.get<{ prompt: string }>(`${this.p(name)}/prompt`));
  }

  generateManual(name: string, text: string) {
    return firstValueFrom(this.http.post<ProxyDetail>(`${this.p(name)}/generate/manual`, { text }));
  }

  restart(name: string) {
    return firstValueFrom(this.http.post<ProxyDetail>(`${this.p(name)}/restart`, {}));
  }

  saveSpec(name: string, spec: OpenApiDoc) {
    return firstValueFrom(this.http.put<ProxyDetail>(`${this.p(name)}/spec`, { spec }));
  }

  discussion(name: string) {
    return firstValueFrom(this.http.get<MessageView[]>(`${this.p(name)}/discussion`));
  }

  send(name: string, message: string) {
    return firstValueFrom(this.http.post<MessageView[]>(`${this.p(name)}/discussion`, { message }));
  }

  clearDiscussion(name: string) {
    return firstValueFrom(this.http.delete<MessageView[]>(`${this.p(name)}/discussion`));
  }

  decide(name: string, id: string, accept: boolean) {
    return firstValueFrom(
      this.http.post<{ detail: ProxyDetail; discussion: MessageView[] }>(`${this.p(name)}/proposals/${encodeURIComponent(id)}/${accept ? 'accept' : 'reject'}`, {}),
    );
  }

  undo(name: string) {
    return firstValueFrom(this.http.post<ProxyDetail>(`${this.p(name)}/undo`, {}));
  }

  approve(name: string, reviewer: string, note: string) {
    return firstValueFrom(this.http.post<ProxyDetail>(`${this.p(name)}/approve`, { reviewer, note }));
  }

  reopen(name: string) {
    return firstValueFrom(this.http.post<ProxyDetail>(`${this.p(name)}/reopen`, {}));
  }

  downloadUrl(name: string): string {
    return `${this.p(name)}/spec/download`;
  }
}
