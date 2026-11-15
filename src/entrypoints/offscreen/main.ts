import { startMatcherHost } from '../../matcher/host';

startMatcherHost(() => new Worker(new URL('../../matcher/worker.ts', import.meta.url), { type: 'module' }));
