import { defineBackground } from 'wxt/utils/define-background';
import type { BackgroundRequest, CoordRequest, Relayed } from '../shared/messages';

// Stateless: MV3 service workers are killed when idle.
export default defineBackground(() => {
  // Serialized so no frame connects before the offscreen listener exists; not cached, so a closed
  // document is recreated.
  let chain: Promise<void> = Promise.resolve();
  function ensureOffscreen(): Promise<void> {
    chain = chain.catch(() => {}).then(async () => {
      if (await chrome.offscreen.hasDocument()) return;
      await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Run user regular expressions in a killable worker' });
    });
    return chain;
  }

  const UNSUPPORTED = 'This page can’t be searched (browser pages, the Web Store and the PDF viewer block extensions).';

  async function sendToTop(tabId: number, msg: CoordRequest): Promise<boolean> {
    try {
      await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
      return true;
    } catch {
      try {
        await injectInto(tabId);
        await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
        return true;
      } catch {
        await chrome.action.setBadgeText({ tabId, text: '✕' });
        await chrome.action.setTitle({ tabId, title: UNSUPPORTED });
        return false;
      }
    }
  }

  async function injectInto(tabId: number): Promise<void> {
    const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files });
  }

  // The "can't search this page" badge belongs to the page, not the tab.
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading') void chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  });

  chrome.action.onClicked.addListener((tab) => { if (tab.id !== undefined) void sendToTop(tab.id, { t: 'coord.toggle' }); });

  chrome.commands.onCommand.addListener((command, tab) => void onCommand(command, tab));
  async function onCommand(command: string, tab?: chrome.tabs.Tab): Promise<void> {
    const tabId = tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (tabId === undefined) return;
    if (command === 'toggle-find') void sendToTop(tabId, { t: 'coord.show' });
    if (command === 'open-panel') {
      await chrome.sidePanel.open({ tabId }); // must run within the user gesture
      void sendToTop(tabId, { t: 'coord.getState' });
    }
  }

  chrome.runtime.onInstalled.addListener(() => void injectIntoOpenTabs());
  async function injectIntoOpenTabs(): Promise<void> {
    for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] })) {
      if (tab.id !== undefined && !tab.discarded) injectInto(tab.id).catch(() => {});
    }
  }

  chrome.runtime.onMessage.addListener((msg: BackgroundRequest, sender, reply) => {
    switch (msg.t) {
      case 'bg.ensureOffscreen':
        ensureOffscreen().then(() => reply(true), (e: unknown) => reply({ error: String(e) }));
        return true;
      case 'bg.relay': {
        const tabId = sender.tab?.id;
        if (tabId === undefined) return false;
        const out: Relayed = { t: 'relayed', fromFrame: sender.frameId ?? 0, msg: msg.msg };
        if (msg.to === 'all') {
          chrome.tabs.sendMessage(tabId, out).catch(() => {});
          reply(null);
          return false;
        }
        chrome.tabs.sendMessage(tabId, out, { frameId: msg.to }).then(reply, () => reply(null));
        return true;
      }
      case 'bg.loadRuntime': {
        const tabId = sender.tab?.id;
        if (tabId === undefined) return false;
        chrome.scripting.executeScript({ target: { tabId, frameIds: [sender.frameId ?? 0] }, files: ['runtime.js'] })
          .then(() => reply(true), (e: unknown) => reply({ error: String(e) }));
        return true;
      }
      case 'bg.openOptions':
        void chrome.runtime.openOptionsPage();
        return false;
      case 'bg.openPanel': {
        const tabId = sender.tab?.id;
        if (tabId === undefined) return false;
        chrome.sidePanel.open({ tabId }).then(() => reply(true), (e: unknown) => reply({ error: String(e) }));
        return true;
      }
    }
    return false;
  });
});
