# Release Notes: Review Hardening Build

This build focuses on production-readiness issues found in the review of `log-graph`.

## Data Correctness

- Input files are no longer assumed to be UTF-8.
- Encoding detection now inspects the first 64 KiB for more stable UTF-8/CP1251/UTF-16 selection.
- Hidden bidi/control Unicode characters are stripped from imported tags.
- Grouped-format `status` values are retained per point.
- When a wide log has an epoch column, it is inferred from several initial rows and becomes the timestamp source of truth; wall-clock columns remain the fallback.
- Epoch is stored as an absolute UTC instant; display and CSV can be explicitly switched between Local and UTC.
- Two-digit years now use the `00..69 => 2000..2069`, `70..99 => 1970..1999` window.
- Merge conflicts on identical `tag + timestamp` are preserved and marked for diagnostics/CSV.
- Raw CSV is now an audit-style long table without interpolation.
- Aligned/interpolated CSV is explicitly separated from raw export.
- Unit conversion keeps raw values for exact rollback.

## Performance

- File decoding and parsing run only in `parser.worker.js`; static serving is required.
- On browsers with `File.stream()`, large files are streamed directly in the worker without a full main-thread `arrayBuffer()`.
- The input-file guardrail is now 8 GiB; full source text is retained only for files up to 25 MiB.
- Parser results leave the worker as columnar typed arrays through a transfer-list, avoiding structured clone of the full point-object tree.
- When run through a cross-origin isolated server runtime, the parser worker emits `SharedArrayBuffer`-backed columns that the main thread and trace worker can read without copying.
- Main application state now stores points through `ColumnarData` instead of object arrays.
- `trace.worker.js` keeps worker-owned state by `dataId`; prepare requests send only id/meta/view. Without `SharedArrayBuffer`, the fallback still uses cloned typed arrays through a transfer-list with a byte guard.
- Render/export/XY/statistics/session snapshot/unit conversion paths now work directly on columns and no longer build temporary point-object arrays in those paths.
- Multi-file loading is bounded to one or two concurrent parse jobs to reduce large-log memory peaks.
- Initial trace downsampling can be precomputed in `trace.worker.js` when served over HTTP.
- Added `MinMaxLTTB` downsampling for long series with short peaks.
- Already ordered series skip the extra point sort.
- Recent load/render/precompute timings are available in diagnostics export.

## Operations

- Session import now validates structure and limits payload size.
- Marker import validates array shape and limits item count.
- Browser persistent storage is requested before saving sessions.
- Test suite and CI workflow are included.
- Build artifact integrity is checked through `build-manifest.json` and tests that compare generated server-runtime files with source files.
- `serve-local.ps1` now serves COOP/COEP/CORP headers to enable cross-origin isolation and `SharedArrayBuffer`.

## Compatibility

Directly opening HTML is no longer a supported runtime mode. The supported runtime is static serving of `build`.
