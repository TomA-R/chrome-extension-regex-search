import type { AgentApi, AgentEvent, Handlers } from '../../shared/messages';
import { DEFAULT_SETTINGS, loadSettings, type Settings } from '../../shared/settings';
import { Agent } from './agent';
import { DomTextSource } from './dom-source';
import { agentHandlers } from './endpoint';
import { bridge } from '../bridge';
import { OffscreenMatcher } from './matcher-client';

export interface FrameRuntime {
  handlers: Handlers<AgentApi>;
  settings: () => Settings;
  ready: Promise<void>;
}

export function startFrame(opts: {
  isTop: boolean;
  exclude: Set<Element>;
  report: (e: AgentEvent) => void;
  avoidTop: () => number;
}): FrameRuntime {
  const suffix = Math.random().toString(36).slice(2, 8);
  const names = { all: `rx-${suffix}-all`, cur: `rx-${suffix}-cur` };
  let settings: Settings = DEFAULT_SETTINGS;
  const ready = loadSettings().then((s) => { settings = s; }, () => {});

  let agent: Agent | null = null;
  const getAgent = (): Agent => {
    agent ??= new Agent({
      source: new DomTextSource(),
      matcher: new OffscreenMatcher(),
      exclude: opts.exclude,
      names,
      colors: { match: settings.matchColor, current: settings.currentColor },
      avoidTop: opts.avoidTop,
      report: opts.report,
    });
    return agent;
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.settings) return;
    void loadSettings().then((s) => {
      settings = s;
      agent?.setColors({ match: s.matchColor, current: s.currentColor });
    });
  });

  // The bootstrap may have received our embed token before this runtime loaded.
  if (!opts.isTop) {
    const b = bridge();
    b.onEmbedToken = (token) => opts.report({ t: 'agent.embedded', token });
    if (b.embedToken) b.onEmbedToken(b.embedToken);
  }
  return { handlers: agentHandlers(getAgent, () => agent), settings: () => settings, ready };
}
