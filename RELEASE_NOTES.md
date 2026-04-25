# Release Notes: Review Hardening Build

This build focuses on production-readiness issues found in the review of `log-graph-v091`.

## Data Correctness

- Input files are no longer assumed to be UTF-8.
- Hidden bidi/control Unicode characters are stripped from imported tags.
- Grouped-format `status` values are retained per point.
- When a wide log has an epoch column, epoch is the timestamp source of truth; wall-clock columns remain the fallback.
- Merge conflicts on identical `tag + timestamp` are preserved and marked for diagnostics/CSV.
- Raw CSV is now an audit-style long table without interpolation.
- Aligned/interpolated CSV is explicitly separated from raw export.
- Unit conversion keeps raw values for exact rollback.

## Performance

- File decoding and parsing run in a worker where available.
- Multi-file loading is bounded to one or two concurrent parse jobs to reduce large-log memory peaks.
- Initial trace downsampling can be precomputed in `trace.worker.js` when served over HTTP.
- Recent load/render/precompute timings are available in diagnostics export.

## Operations

- Session import now validates structure and limits payload size.
- Marker import validates array shape and limits item count.
- Browser persistent storage is requested before saving sessions.
- Test suite and CI workflow are included.
- Build artifact integrity is checked through `build-manifest.json` and tests that compare generated artifacts with source files.

## Compatibility

Directly opening `log-graph-v091.html` is still supported only as the generated standalone fallback. The supported runtime is static serving of `dist/server`.
