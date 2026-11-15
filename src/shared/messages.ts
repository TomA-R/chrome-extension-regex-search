import type { Query } from '../core/query';

// An API maps method name -> [params, result]; a request is {t: method, ...params}.
type Api<A> = { [K in keyof A]: [object, unknown] };
export type Method<A extends Api<A>> = keyof A & string;
export type Params<A extends Api<A>, K extends Method<A>> = A[K][0];
export type Result<A extends Api<A>, K extends Method<A>> = A[K][1];
export type Request<A extends Api<A>, K extends Method<A> = Method<A>> = { [M in K]: { t: M } & Params<A, M> }[K];
export type NoParams = Record<never, never>;
export type Handlers<A extends Api<A>> = { [K in Method<A>]: (req: Request<A, K>) => Result<A, K> | Promise<Result<A, K>> };

export function dispatch<A extends Api<A>>(handlers: Handlers<A>, req: Request<A>): Promise<unknown> {
  const h = handlers[req.t];
  return Promise.resolve(h(req));
}

export const MATCHER_PORT = 'rx-matcher';

export type MatcherRequest =
  | { op: 'reset'; gen: number }
  | { op: 'append'; gen: number; chunk: string }
  | { op: 'splice'; gen: number; start: number; end: number; insert: string }
  | { op: 'search'; id: number; gen: number; source: string; flags: string; max: number; timeoutMs: number }
  | { op: 'expand'; id: number; gen: number; source: string; flags: string; template: string; starts: number[]; timeoutMs: number };

export type MatcherResponse =
  | { op: 'result'; id: number; gen: number; ranges: number[]; total: number; truncated: boolean; ms: number }
  | { op: 'expanded'; id: number; values: (string | null)[] }
  | { op: 'error'; id: number; kind: 'timeout' | 'syntax' | 'internal' | 'superseded'; message: string };

export type WorkerRequest = MatcherRequest;
export type WorkerResponse = MatcherResponse;

export type SearchSpec = { session: number; source: string; flags: string; max: number; timeoutMs: number; searchFields: boolean };

export interface Snippet {
  frameId: number;
  index: number;
  before: string;
  match: string;
  after: string;
  editable: boolean;
}

export interface ReplaceResult {
  replaced: number;
  skipped: number;
  current?: number;
}

export interface AgentApi {
  'agent.search': [{ spec: SearchSpec }, true];
  'agent.goto': [{ session: number; index: number }, { editable: boolean }];
  'agent.clearCurrent': [NoParams, true];
  'agent.stop': [NoParams, true];
  'agent.snippets': [{ start: number; limit: number }, Snippet[]];
  'agent.texts': [NoParams, string[]];
  'agent.replace': [{ index: number | 'all'; template: string }, ReplaceResult];
  'agent.scrollChildIntoView': [{ token: string }, true];
}
export type AgentRequest = Request<AgentApi>;

export type AgentStatus = 'indexing' | 'searching' | 'done' | 'error' | 'timeout';

export type AgentEvent =
  | {
    t: 'agent.update';
    session: number;
    status: AgentStatus;
    count: number;
    total: number;
    truncated: boolean;
    current?: number;
    firstVisible: number;
    embeds: [string, number][];
    error?: string;
  }
  | {
    t: 'agent.embedded';
    token: string;
  };
export type AgentUpdate = Extract<AgentEvent, { t: 'agent.update' }>;

export interface Relayed { t: 'relayed'; fromFrame: number; msg: AgentRequest | AgentEvent }

export type CoordStatus = 'idle' | 'indexing' | 'searching' | 'done' | 'error' | 'timeout';

export interface CoordState {
  open: boolean;
  query: Query;
  status: CoordStatus;
  error?: string;
  total: number;
  matched: number;
  current: number;
  truncated: boolean;
  currentEditable: boolean;
  frames: number;
}

export interface CoordApi {
  'coord.toggle': [NoParams, CoordState];
  'coord.show': [NoParams, CoordState];
  'coord.close': [NoParams, CoordState];
  'coord.getState': [NoParams, CoordState];
  'coord.setQuery': [{ query: Query }, CoordState];
  'coord.next': [NoParams, CoordState];
  'coord.prev': [NoParams, CoordState];
  'coord.goto': [{ frameId: number; index: number }, CoordState];
  'coord.snippets': [{ offset: number; limit: number }, { items: Snippet[]; total: number }];
  'coord.copyAll': [NoParams, string[]];
  'coord.replace': [{ template: string; all: boolean }, ReplaceResult];
}
export type CoordRequest = Request<CoordApi>;

// A tab port, so state pushes don't wake the service worker.
export const PANEL_PORT = 'rx-panel';
export interface PanelPush { t: 'state'; state: CoordState }

export type BackgroundRequest =
  | { t: 'bg.ensureOffscreen' }
  | { t: 'bg.relay'; to: number | 'all'; msg: AgentRequest | AgentEvent }
  | { t: 'bg.openPanel' }
  | { t: 'bg.openOptions' }
  | { t: 'bg.loadRuntime' };
