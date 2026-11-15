import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

export function Menu({ children, onClose, returnFocus }: { children: ComponentChildren; onClose: () => void; returnFocus: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const items = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? [])];

  // Synchronous, so a fast Enter right after opening lands on the first item, not the menu button.
  useLayoutEffect(() => {
    items()[0]?.focus();
    return returnFocus;
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(e.target as HTMLButtonElement);
    const to = e.key === 'ArrowDown' ? (i + 1) % list.length
      : e.key === 'ArrowUp' ? (i - 1 + list.length) % list.length
        : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : -1;
    if (to >= 0) { e.preventDefault(); list[to]?.focus(); }
    else if (e.key === 'Tab') onClose();
  };

  return <div class="menu" role="menu" ref={ref} onKeyDown={onKeyDown}>{children}</div>;
}
