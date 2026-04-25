# Runbook

## Local Launch

Build first, then serve `dist/server` as static files. Direct browser opening is only the generated standalone fallback.

```bash
cd dist/server
python -m http.server 8080
```

Open `http://localhost:8080/log-graph-v091.html`.

## Verification

```bash
npm test
```

Expected result: all tests pass.

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
8. Check `dist/server/build-manifest.json`; the SHA-256 for `src/app.js` must match the current checkout.
