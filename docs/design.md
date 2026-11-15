# Design notes

Numbers are from headless Chromium.

## Highlighting

Matches are drawn with the CSS Custom Highlight API instead of being wrapped in `<mark>`, which mutates the page and breaks layouts and frameworks. On a page with 72k matches, highlights paint in 100 ms. `<mark>` takes 650 ms to apply and 770 ms to remove.

Repaint cost grows with the number of registered ranges: moving the current match takes 80 ms per frame at 72k. So only ranges near the viewport are registered, which keeps frames at 16 ms regardless of the total. An IntersectionObserver over the match containers decides which ranges those are, and it handles nested scrollers, sticky elements and grid reordering.

## Regex execution

Patterns run in a worker inside an offscreen document, and the worker is terminated on timeout. Other hosts fail somewhere:
- blob workers under a strict `worker-src` CSP;
- extension-URL workers, which are refused cross-origin;
- extension iframes, on COEP and sandboxed pages.

The worker keeps a copy of the frame's text, so each keystroke sends only the pattern.

## Text model

Each frame is flattened into one string, with offsets mapped back to text nodes:
- Block boundaries become separators, so matches cross inline formatting but not paragraphs.
- Whitespace collapses as CSS renders it.
- Hidden text is skipped. Closed `<details>` and `hidden=until-found` content is included and opened on navigation.
- Shadow roots (open and closed) and form fields are included. Password fields are not.

Indexing is time-sliced. When only text changes (timers, tickers), the model is rebuilt from the previous one without walking the DOM.

## Frames and isolation

- Each frame runs its own search. The top frame orders the results in document order.
- Chrome gives content scripts no way to map an iframe element to its frame id, so parent and child exchange a token via `postMessage`.
- The find bar lives in a closed shadow root in the top layer.
- A `document_start` listener stops the bar's keyboard events from reaching page shortcuts.
- Only a 5.5 kB bootstrap runs on every page. The rest loads when a frame is first searched.

## Limitations

- Virtualized views (GitHub's code view, Slack) only expose part of their content to the DOM.
- Canvas apps (Google Docs) and the PDF viewer can't be searched.
- At most 100k matches per frame are highlighted. The total is still counted.
