import { defineContentScript } from 'wxt/utils/define-content-script';
import { bridge } from '../content/bridge';
import { listenForEmbedToken } from '../content/frame/frames';
import { guardHost, installGuard, unguardHost } from '../content/guard';
import { PANEL_PORT, type BackgroundRequest, type CoordRequest, type Relayed } from '../shared/messages';

// Runs in every frame at document_start, so it stays tiny; the full runtime loads on first use.
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  main() {
    const b = bridge();
    // Manifest and post-install programmatic injection can both run.
    if ((b as unknown as { booted?: boolean }).booted) return;
    (b as unknown as { booted?: boolean }).booted = true;

    installGuard();
    b.guard = { add: guardHost, remove: unguardHost };
    listenForEmbedToken((token) => { b.embedToken = token; b.onEmbedToken?.(token); });

    let loading: Promise<boolean> | null = null;
    const ensureRuntime = (): Promise<boolean> => {
      if (b.runtime) return Promise.resolve(true);
      loading ??= chrome.runtime.sendMessage({ t: 'bg.loadRuntime' } satisfies BackgroundRequest)
        .then(() => !!b.runtime, () => false)
        .finally(() => { loading = null; });
      return loading;
    };

    chrome.runtime.onMessage.addListener((msg: Relayed | CoordRequest, _sender, reply) => {
      if (b.runtime) return b.runtime.onMessage(msg, reply);
      if (!needsRuntime(msg)) return false;
      void ensureRuntime().then((ok) => { if (!ok || !b.runtime!.onMessage(msg, reply)) reply(null); });
      return true;
    });
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== PANEL_PORT || window !== window.top) return;
      void ensureRuntime().then((ok) => (ok ? b.runtime!.onConnect(port) : port.disconnect()));
    });
  },
});

function needsRuntime(msg: Relayed | CoordRequest): boolean {
  if (msg.t !== 'relayed') return msg.t.startsWith('coord.') && msg.t !== 'coord.close';
  const t = msg.msg.t;
  return t === 'agent.search';
}
