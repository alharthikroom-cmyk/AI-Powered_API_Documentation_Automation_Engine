export type RegistryStatus = 'undocumented' | 'review' | 'approved';
export type OpenApiDoc = Record<string, any>;
export type StepNo = 1 | 2 | 3 | 4 | 5 | 6;
export type ReviewTab = 'swagger' | 'discuss' | 'checks';

export interface SourcesView {
  apigee: { organization: string; environment: string; proxies: number };
  splunk: { index: string; sourcetype: string; events: number };
  brain: { mode: 'claude' | 'openai' | 'mock'; model: string };
}

export interface ProxySummary {
  name: string;
  basePath: string;
  revision: string;
  flows: number;
  events: number;
  status: RegistryStatus;
  completed: number;
  pending: number;
}

export interface OperationSummary {
  method: string;
  path: string;
  flow: string;
  samples: number;
  codes: string[];
}

export interface FlowView {
  name: string;
  condition: string;
  method: string;
  path: string;
  params: string[];
}

export interface ApigeeStepView {
  fetchedAt: string;
  organization: string;
  environment: string;
  managementCall: string;
  proxy: { name: string; revision: string; basePath: string; virtualHost: string; targetServer: string | null; owner: string | null };
  flows: FlowView[];
  skipped: string[];
}

export interface SamplePreview {
  method: string;
  path: string;
  status: number | null;
  pathParams: Record<string, string> | null;
  query: Record<string, string> | null;
  request: unknown;
  response: unknown;
}

export interface SplunkStepView {
  fetchedAt: string;
  index: string;
  sourcetype: string;
  query: string;
  totalEvents: number;
  matched: number;
  unmatched: number;
  mask: boolean;
  operations: OperationSummary[];
  previews: SamplePreview[];
}

export interface Check {
  ok: boolean;
  label: string;
  detail: string;
}

export interface ProxyDetail extends ProxySummary {
  virtualHost: string;
  targetServer: string | null;
  mask: boolean;
  startedAt: string | null;
  apigee: ApigeeStepView | null;
  splunk: SplunkStepView | null;
  spec: OpenApiDoc | null;
  specVersion: number | null;
  specSource: string | null;
  canUndo: boolean;
  checks: Check[] | null;
  acceptedChanges: number;
  approvedAt: string | null;
  approvedBy: string | null;
  approvalNote: string | null;
}

export interface PatchOpView {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
  old?: unknown;
}

export interface ProposalView {
  id: string;
  summary: string;
  ops: PatchOpView[];
  status: 'pending' | 'accepted' | 'rejected';
}

export interface MessageView {
  id: number;
  role: 'user' | 'ai' | 'sys';
  text: string;
  error: string | null;
  createdAt: string;
  proposals: ProposalView[];
}
