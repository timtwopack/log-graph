# Changelog

## 0.9.1-review-hardening

- Added encoding-aware input loader for UTF-8, Windows-1251, UTF-16LE, and UTF-16BE files.
- Moved file decoding/parsing to `parser.worker.js` for static-server runs, with inline blob fallback for direct file opening.
- Added optional `trace.worker.js` precompute path for initial downsampling/cache warmup.
- Preserved grouped-format `status` values per point.
- Preserved optional epoch timestamp as `epochUs` while keeping the UI on the local timestamp columns.
- Added `signalKind` (`analog`, `binary`, `step`, `setpoint`) and per-parameter override in the sidebar.
- Added quality filter for excluding non-good status points from charts, statistics, smoothing, and anomaly detection.
- Replaced ambiguous raw CSV with `raw-long` export that contains only original points and no interpolation.
- Added explicit aligned CSV export for interpolated wide output.
- Changed default CSV encoding to UTF-8 with BOM; retained CP1251 as a legacy raw export.
- Preserved raw values/raw units during unit conversion for exact rollback and raw-long audit export.
- Added session and marker import validation, size limits, and text normalization.
- Added local diagnostics JSON export with performance samples and runtime errors.
- Added Node test suite and GitHub Actions workflow.
- Added `src/`, `dist/server`, and `dist/single-file` structure.
- Added `tools/build.mjs` to build the primary server runtime and optional standalone HTML.
- Portable zip now contains only the supported server runtime by default; standalone is included only with `-IncludeStandalone`.
