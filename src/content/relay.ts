import type { AgentEvent, AgentRequest, BackgroundRequest } from '../shared/messages';

export function relay<T = unknown>(to: number | 'all', msg: AgentRequest | AgentEvent): Promise<T | null> {
  return chrome.runtime.sendMessage({ t: 'bg.relay', to, msg } satisfies BackgroundRequest).catch(() => null) as Promise<T | null>;
}
