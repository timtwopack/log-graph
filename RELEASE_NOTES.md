# Release Notes: Review Hardening Build

This build focuses on production-readiness issues found in the review of `log-graph-v091`.

## Data Correctness

- Input files are no longer assumed to be UTF-8.
- Hidden bidi/control Unicode characters are stripped from imported tags.
- Grouped-format `status` values are retained per point.
- Raw CSV is now an audit-style long table without interpolation.
- Aligned/interpolated CSV is explicitly separated from raw export.
- Unit conversion keeps raw values for exact rollback.

## Performance

- File decoding and parsing run in a worker where available.
- Initial trace downsampling can be precomputed in `trace.worker.js` when served over HTTP.
- Recent load/render/precompute timings are available in diagnostics export.

## Operations

- Session import now validates structure and limits payload size.
- Marker import validates array shape and limits item count.
- Browser persistent storage is requested before saving sessions.
- Test suite and CI workflow are included.

## Compatibility

Directly opening `log-graph-v091.html` is still supported. Static serving is recommended for full worker behavior.
