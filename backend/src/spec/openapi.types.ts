export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type OpenApiDoc = Record<string, any>;

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

export const HINT_FIELDS = [
  'path_examples_for_ai',
  'query_parameters_examples_for_ai',
  'headers_parameters_examples_for_ai',
  'body_examples_for_ai',
] as const;

export interface ParsedFlow {
  name: string;
  verb: string;
  path: string;
  params: string[];
  rx: RegExp;
  wild: number;
}

export interface OperationSummary {
  method: string;
  path: string;
  flow: string;
  samples: number;
  codes: string[];
}

export interface BuildResult {
  spec: OpenApiDoc;
  operations: OperationSummary[];
  totalEvents: number;
  unmatched: number;
}

export interface Check {
  ok: boolean;
  label: string;
  detail: string;
}

export interface PatchOp {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
}
