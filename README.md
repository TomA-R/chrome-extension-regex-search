# Regex Find

Regex find-in-page for Chrome. Works in iframes, shadow DOM and form fields. Supports replace in editable fields and has a results side panel.

## Install

```sh
npm install
npm run build
```

Load `dist/chrome-mv3` as an unpacked extension (`chrome://extensions`, Developer mode).

## Keys

| | |
|---|---|
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> | Open the find bar |
| <kbd>Enter</kbd> / <kbd>Shift</kbd>+<kbd>Enter</kbd> | Next / previous match |
| <kbd>Alt</kbd>+<kbd>R</kbd> / <kbd>C</kbd> / <kbd>W</kbd> / <kbd>S</kbd> | Toggle regex / case / whole word / dot-all |
| <kbd>↑</kbd> / <kbd>↓</kbd> | History |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> | Results panel |
| <kbd>Esc</kbd> | Close |

## Development

```sh
npm run dev        # Chrome with the extension loaded, rebuilt on save
npm run check      # typecheck, lint, unit tests
npm run test:e2e   # component and end-to-end tests
npm run coverage   # unit + browser coverage, merged -> coverage/report/index.html
```

See [docs/design.md](docs/design.md) for the design.

## License

[MIT](LICENSE)
