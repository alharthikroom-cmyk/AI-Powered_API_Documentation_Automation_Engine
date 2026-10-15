export interface ApigeeFlow {
  name: string;
  condition: string;
}

export interface ApigeeProxy {
  name: string;
  revision: string;
  basePath: string;
  virtualHost: string;
  targetServer?: string;
  owner?: string;
  flows: ApigeeFlow[];
}

export interface ApigeeExport {
  organization: string;
  environment: string;
  exportedAt?: string;
  proxies: ApigeeProxy[];
}

export interface SplunkEvent {
  _time: string;
  proxy: string;
  request: {
    verb: string;
    uri: string;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
  };
}

export interface SplunkExport {
  index: string;
  sourcetype?: string;
  searchedAt?: string;
  events: SplunkEvent[];
}
