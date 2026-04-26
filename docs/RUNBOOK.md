# Runbook

## Local Launch

Build first, then serve `dist/server` as static files. Direct browser opening is not a supported runtime mode.

```bash
cd dist/server
python -m http.server 8080
```

Open `http://localhost:8080/index.html`.

## Large Files

- File import runs in `parser.worker.js`.
- When the browser supports `File.stream()`, the worker reads the log as a stream and the main thread does not build a full `arrayBuffer()` for the file.
- Maximum input file size is 8 GiB. This is an application guardrail, not a promise that every workstation can handle every 8 GiB log.
- For files larger than 25 MiB, the app does not retain the full source text in memory. Charts, CSV export, sessions, and diagnostics use parsed series, but save-with-renamed-tags is disabled.
- For moving work between PCs, export a `.pagraph.json.gz` session instead of putting source logs into the portable zip.

## Time And Quality

- If an epoch column exists, epoch is the timestamp source of truth.
- Epoch is treated as an absolute UTC instant. The UI has a `Local`/`UTC` switch that changes the X-axis display, time labels, and CSV timestamps.
- Without epoch, `Date/Time/ms` columns are interpreted as local browser time on the current PC.
- Good `status` values are empty status, numeric `0`, `good`, `ok`, `valid`, `норма`, `норм`, `goodprovider`, and `goodlocaloverride`, ignoring case and surrounding whitespace.

## Verification

```bash
npm test
```

Expected result: all tests pass.

## Review Handoff

For code/architecture review, build the source bundle:

```powershell
npm run review:bundle
```

Send `dist/log-graph-review-source-*.zip`. Do not send a standalone `log-graph-v091.html` from older builds; the current entrypoint is generated as `dist/server/index.html` and should be checked through `npm run build`.

Before a full review, include `docs/REVIEW_READINESS.md`; it lists closed items, intentional tradeoffs, and remaining large topics.

## Browser Storage

Sessions are stored in IndexedDB only after the user selects save/import. Presets and markers use localStorage. To clear all local state:

1. Open browser DevTools.
2. Go to Application / Storage.
3. Use Clear site data for the origin.

The app requests persistent storage when saving sessions. Browser policy can still deny this request.

## Session Recovery

Use `Сессия -> Экспорт в файл` to archive portable `.pagraph.json.gz` sessions. If browser storage is cleared or corrupted, import that file through `Сессия -> Импорт из файла`.

If an imported session fails validation:

- check file size first;
- confirm the JSON contains an `ap` array;
- verify `x` and `y` arrays have numeric values;
- reduce oversized sessions beyond project limits.

## Diagnostics

Use `Сессия -> Диагностика JSON` to export local diagnostics. The file contains:

- loaded file names;
- parameter counts and point counts;
- bad-quality point counts;
- time-source and merge-conflict counts;
- recent performance samples;
- runtime errors captured locally;
- browser storage estimate when supported.

No diagnostics are sent over the network by the app.

## Release Checklist

1. Run `npm test`.
2. Open the app through a local static server.
3. Load `data_base/test_base.txt` from a clean checkout, or a real plant log during local acceptance.
4. Verify first three parameters render.
5. Export `CSV сырой long` and confirm `°C`, epoch µs, time source, and merge-conflict columns are preserved.
6. Save a browser session and export a session file.
7. Reload the page and import the session file.
8. Check `dist/server/build-manifest.json`; the SHA-256 values for source files and `package.json` must match the current checkout.
