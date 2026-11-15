import { dispatch, type AgentEvent, type AgentRequest, type CoordApi, type Handlers, type PanelPush } from '../../shared/messages';
import { pushHistory } from '../../shared/settings';
import type { FrameRuntime } from '../frame/runtime';
import { hasChildFrames } from '../frame/frames';
import { relay } from '../relay';
import { Coordinator, type AgentBus } from './coordinator';
import { BarController } from './bar-controller';

export interface TopRuntime {
  handlers: Handlers<CoordApi>;
  onPanelPort(port: chrome.runtime.Port): void;
  onAgentEvent(e: AgentEvent, fromFrame: number): void;
  barBottom(): number;
}

export function startTop(frame: FrameRuntime, exclude: Set<Element>): TopRuntime {
  const bus: AgentBus = {
    request: (frameId, req) => (frameId === 0 ? dispatch(frame.handlers, req as AgentRequest) : relay(frameId, req as AgentRequest)) as never,
    broadcast: (req) => { if (hasChildFrames()) void relay('all', req); },
  };
  const coord = new Coordinator({ bus, settings: frame.settings, recordHistory: (q) => void pushHistory(q) });

  const bar = new BarController(coord, frame, exclude);
  const show = () => bar.show();
  const hide = () => bar.hide();

  addEventListener('keydown', (e: KeyboardEvent) => {
    if (!coord.state.open || bar.owns(e.target)) return;
    if (e.key === 'F3' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g')) {
      e.preventDefault();
      if (e.shiftKey) coord.prev();
      else coord.next();
    }
  }, true);

  const onPanelPort = (port: chrome.runtime.Port): void => {
    const off = coord.subscribe((state) => { try { port.postMessage({ t: 'state', state } satisfies PanelPush); } catch { off(); } });
    port.onDisconnect.addListener(() => off());
  };

  const handlers: Handlers<CoordApi> = {
    'coord.toggle': async () => { if (coord.state.open) hide(); else await show(); return coord.state; },
    'coord.show': async () => { await show(); return coord.state; },
    'coord.close': () => { hide(); return coord.state; },
    'coord.getState': () => coord.state,
    'coord.setQuery': async ({ query }) => {
      if (!coord.state.open) await show(); // never search without a visible bar (and its Esc)
      coord.setQuery(query, true);
      return coord.state;
    },
    'coord.next': () => { coord.next(); return coord.state; },
    'coord.prev': () => { coord.prev(); return coord.state; },
    'coord.goto': async ({ frameId, index }) => { await coord.goto(frameId, index); return coord.state; },
    'coord.snippets': ({ offset, limit }) => coord.snippets(offset, limit),
    'coord.copyAll': () => coord.allTexts(),
    'coord.replace': ({ template, all }) => coord.replace(template, all),
  };

  return {
    handlers,
    onPanelPort,
    onAgentEvent: (e, fromFrame) => (e.t === 'agent.update' ? coord.onUpdate(e, fromFrame) : coord.onEmbedded(e.token, fromFrame)),
    barBottom: () => (coord.state.open ? bar.bottom() : 0),
  };
}
