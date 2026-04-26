# Review Readiness

This document captures the current project state before the next full code/architecture review.

## Review Scope

- Source: `src/`, `tools/`, `tests/`, `vendor/`, `.github/`.
- Documentation: `README.md`, `docs/`, `review/`.
- Generated runtime is not the source of truth: `dist/server` is rebuilt from source.
- The old `log-graph-v091.html` artifact is not required and is not stored in Git.

## Commands

```powershell
npm test
powershell -ExecutionPolicy Bypass -File .\make-portable.ps1
npm run review:bundle
```

For manual testing:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve-local.ps1
```

Open `http://127.0.0.1:8765/index.html`.

## Closed Since The Last Review

- Direct HTML opening is no longer the supported runtime mode; static serving is required so workers behave predictably.
- Large-file import uses `File.stream()` in `parser.worker.js` without reading the full file on the main thread.
- Parser and main-state now use `ColumnarData`: `ts/val` live in `Float64Array`, boolean flags in `Uint8Array`, and string fields in dictionary-coded columns.
- Parser results leave the worker as columnar typed arrays through a transfer-list; the main thread no longer stores base points as `{ts,val,...}` object arrays.
- Full raw text is retained only up to 25 MiB; save-with-renamed-tags is disabled for larger files.
- Optional `trace.worker.js` precompute receives cloned typed arrays through a transfer-list; a byte guard skips very large selected datasets to avoid doubling hundreds of MiB.
- Render/export/XY/statistics/session snapshot/unit conversion paths read and write columns directly without temporary point-object arrays.
- Merge preserves conflict audit data, then stores merged series back in `ColumnarData`.
- Encoding sniffing now uses a 64 KiB sample.
- Wide-log epoch columns are inferred from several initial rows.
- Two-digit years use the `00..69 => 2000..2069`, `70..99 => 1970..1999` window.
- `MinMaxLTTB` downsampling was added.
- `status` quality normalization was made more robust.

## Intentional Tradeoffs

- To reduce risk, `ColumnarData` keeps an array-like API (`length`, index access, `map/filter/some`, iterator). That API remains for compatibility and tests; performance-sensitive paths now use direct column access.
- Plotly remains the chart engine because of the current feature set. A uPlot/eCharts migration should be handled as a separate spike.
- Classic workers remain in place for a simple static runtime without a bundler. Module workers can be revisited later, but they are not a local-operations blocker.
- Security hardening is not prioritized when it reduces readability or performance. The project is designed for local trusted logs.
- True zero-copy trace-worker rendering without copying main-state buffers would require worker-owned state or `SharedArrayBuffer` with COOP/COEP; the current implementation keeps main buffers attached and limits the extra copy with a byte guard.

## Remaining Large Topics

- Alternative chart-engine prototype for series above one million points per parameter.
- Memory/performance benchmarks on a synthetic 500 MiB+ log and a real plant log.
- A separate UTC/local wall-clock strategy if logs without epoch appear from multiple time zones.
