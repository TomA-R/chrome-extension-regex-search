export const yieldToMain: () => Promise<void> =
  typeof (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler?.yield === 'function'
    ? () => (globalThis as unknown as { scheduler: { yield: () => Promise<void> } }).scheduler.yield()
    : () => new Promise((r) => setTimeout(r, 0));

export function slicer(sliceMs = 8, signal?: AbortSignal): { tick(): Promise<void> | void } {
  let deadline = performance.now() + sliceMs;
  return {
    tick() {
      if (performance.now() <= deadline) return;
      return yieldToMain().then(() => {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        deadline = performance.now() + sliceMs;
      });
    },
  };
}
