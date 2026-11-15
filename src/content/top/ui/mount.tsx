import { render } from 'preact';
import { bridge } from '../../bridge';
import { FindBar, type BarProps } from './FindBar';
import { BAR_CSS } from './styles';

const HOST_STYLE = [
  'all:initial', 'position:fixed', 'top:10px', 'right:16px', 'left:auto', 'bottom:auto', 'inset-inline-start:auto',
  'margin:0', 'padding:0', 'border:0', 'background:transparent', 'overflow:visible', 'z-index:2147483647',
  'width:auto', 'height:auto', 'display:block', 'color-scheme:light dark',
].map((d) => `${d} !important`).join(';');

export interface MountedBar { host: HTMLElement; unmount(): void; height(): number }

// A modal <dialog> makes everything outside it inert, so the host lives inside the top-most modal.
function placement(): Element {
  const modals = document.querySelectorAll('dialog:modal');
  return modals[modals.length - 1] ?? document.documentElement;
}

// Top layer (popover) keeps it above page dialogs and fullscreen elements.
export function mountBar(props: BarProps): MountedBar {
  const host = document.createElement('rx-find-bar');
  host.setAttribute('style', HOST_STYLE);
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(BAR_CSS);
  root.adoptedStyleSheets = [sheet];
  bridge().guard.add(host, root);
  try { host.popover = 'manual'; } catch { /* unsupported */ }

  const place = (): void => {
    const target = placement();
    if (host.parentNode === target && host.isConnected) return;
    const hadFocus = !!root.activeElement;
    try { host.hidePopover(); } catch { /* not showing */ }
    target.append(host);
    try { host.showPopover(); } catch { /* not supported */ }
    if (hadFocus || target !== document.documentElement) root.querySelector('input')?.focus();
  };
  place();
  render(<FindBar {...props} />, root);
  // Modals open/close and pages remove nodes without reliable events: re-check cheaply.
  const timer = setInterval(place, 250);

  return {
    host,
    unmount: () => { clearInterval(timer); render(null, root); bridge().guard.remove(host); host.remove(); },
    height: () => (host.isConnected ? host.getBoundingClientRect().bottom : 0),
  };
}
