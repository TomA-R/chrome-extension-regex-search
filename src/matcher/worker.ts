/// <reference lib="webworker" />
// A separate worker so a runaway regex can be terminated.
import type { WorkerRequest } from '../shared/messages';
import { createEngine } from './engine';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const handle = createEngine((m) => scope.postMessage(m));
scope.onmessage = (e: MessageEvent<WorkerRequest>) => handle(e.data);
