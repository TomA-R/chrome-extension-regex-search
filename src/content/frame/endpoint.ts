import type { AgentApi, Handlers } from '../../shared/messages';
import type { Agent } from './agent';
import { iframeByToken } from './frames';
import { scrollToRect } from './navigate';

// `existing`: stop/clearCurrent must not create an agent just to do nothing.
export function agentHandlers(agent: () => Agent, existing: () => Agent | null): Handlers<AgentApi> {
  return {
    'agent.search': ({ spec }) => { agent().search(spec); return true; },
    'agent.goto': ({ session, index }) => existing()?.goto(session, index) ?? { editable: false },
    'agent.clearCurrent': () => { existing()?.clearCurrent(); return true; },
    'agent.stop': () => { existing()?.stop(); return true; },
    'agent.snippets': ({ start, limit }) => existing()?.snippets(start, limit) ?? [],
    'agent.texts': () => existing()?.texts() ?? [],
    'agent.replace': ({ index, template }) => existing()?.replace(index, template) ?? { replaced: 0, skipped: 0 },
    'agent.scrollChildIntoView': ({ token }) => {
      const el = iframeByToken(token);
      if (el) scrollToRect(el, () => el.getBoundingClientRect());
      return true;
    },
  };
}
