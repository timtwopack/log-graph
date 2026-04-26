# Changelog

## 0.9.1-review-hardening

- Added encoding-aware input loader for UTF-8, Windows-1251, UTF-16LE, and UTF-16BE files.
- Moved file decoding/parsing to `parser.worker.js` for static-server runs.
- Removed duplicate main-thread/blob parser fallbacks; static serving is now required for imports.
- Added optional `trace.worker.js` precompute path for initial downsampling/cache warmup.
- Preserved grouped-format `status` values per point.
- Preserved optional epoch timestamp as `epochUs` and use it as the timestamp source of truth; local date/time columns remain the fallback.
- Bounded multi-file loading to one or two concurrent parse jobs to reduce large-log memory peaks.
- Preserve and mark same-`tag + timestamp` conflicts with different values/status as merge conflicts.
- Save-with-rename now edits only exact header cells instead of replacing every matching substring in the header line.
- Grouped parser accepts both Russian `Дата/Время` and English `Date/Time` headers.
- Added `make-review-bundle.ps1` / `npm run review:bundle` so reviews receive the source bundle without generated/stale HTML.
- Added a regression test for UTF-16LE/UTF-16BE log decoding.
- Added `signalKind` (`analog`, `binary`, `step`, `setpoint`) and per-parameter override in the sidebar.
- Added quality filter for excluding non-good status points from charts, statistics, smoothing, and anomaly detection.
- Replaced ambiguous raw CSV with `raw-long` export that contains only original points and no interpolation.
- Added explicit aligned CSV export for interpolated wide output.
- Changed default CSV encoding to UTF-8 with BOM; retained CP1251 as a legacy raw export.
- Preserved raw values/raw units during unit conversion for exact rollback and raw-long audit export.
- Added session and marker import validation, size limits, and text normalization.
- Added local diagnostics JSON export with performance samples and runtime errors.
- Added Node test suite and GitHub Actions workflow.
- Added the `src/`, `docs/`, `review/`, and `dist/server` structure.
- Added `tools/build.mjs` to build the single supported server runtime.
- Added `build-manifest.json` with SHA-256 input hashes and tests that guard against source/server drift.
- App version is now injected from `package.json` during build.
- Portable zip is now only a package of the supported server runtime plus `serve-local.ps1`.
