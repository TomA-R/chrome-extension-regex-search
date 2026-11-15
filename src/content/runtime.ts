import { bridge } from './bridge';
import { startFrame } from './frame/runtime';
import { relay } from './relay';
import { startTop, type TopRuntime } from './top/runtime';
import { dispatch, PANEL_PORT, type CoordRequest, type Relayed } from '../shared/messages';

export function startRuntime(): void {
  const b = bridge();
  if (b.runtime) return;
  const isTop = window === window.top;
  const exclude = new Set<Element>();
  let top: TopRuntime | null = null;
  const frame = startFrame({
    isTop,
    exclude,
    report: (e) => (isTop ? top?.onAgentEvent(e, 0) : void relay(0, e)),
    avoidTop: () => top?.barBottom() ?? 0,
  });
  if (isTop) top = startTop(frame, exclude);

  b.runtime = {
    onMessage(raw, reply) {
      const msg = raw as Relayed | CoordRequest;
      if (msg.t === 'relayed') {
        const inner = msg.msg;
        if (inner.t === 'agent.update' || inner.t === 'agent.embedded') { top?.onAgentEvent(inner, msg.fromFrame); return false; }
        if (isTop && msg.fromFrame === 0) return false; // the top frame's own broadcast
        dispatch(frame.handlers, inner).then(reply, () => reply(null));
        return true;
      }
      if (top && msg.t.startsWith('coord.')) {
        dispatch(top.handlers, msg).then(reply, () => reply(null));
        return true;
      }
      return false;
    },
    onConnect(port) {
      if (port.name === PANEL_PORT && top) top.onPanelPort(port);
    },
  };
}
