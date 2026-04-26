# Review Readiness

This document captures the current project state before the next full code/architecture review.

## Review Scope

- Source: `src/`, `tools/`, `tests/`, `vendor/`, `.github/`.
- Documentation: `README.md`, `docs/`, `review/`.
- Generated runtime is not the source of truth: `build` is rebuilt from source.
- The old `log-graph-v091.html` artifact is not required and is not stored in Git.

## Commands

```powershell
npm test
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
- The supported `serve-local.ps1` enables COOP/COEP, allowing the parser worker to emit `SharedArrayBuffer`-backed columns.
- `trace.worker.js` is now a persistent worker-owned state: the main thread registers series by `dataId`, and prepare requests send only id/meta/view. With SharedArrayBuffer this is zero-copy between main and worker without detaching buffers.
- Without cross-origin isolation, precompute still falls back to cloned typed arrays through a transfer-list; a byte guard skips very large selected datasets to avoid doubling hundreds of MiB.
- Render/export/XY/statistics/session snapshot/unit conversion paths read and write columns directly without temporary point-object arrays.
- Merge preserves conflict audit data, then stores merged series back in `ColumnarData`.
- Epoch is stored as an absolute UTC instant; UI and CSV now have a Local/UTC display switch. Logs without epoch remain local wall-clock fallback, with no implicit UTC conversion.
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
- True zero-copy requires a cross-origin isolated HTTP runtime. If the project is served without COEP, the app automatically falls back to transferable clones for trace precompute.

## Not Blocking This Review

- An alternative chart engine for series above one million points per parameter remains a separate product spike: the current code no longer stores data as an object graph, but Plotly still defines the interactive rendering ceiling.
- Memory/performance benchmarks on a synthetic 500 MiB+ log and a real plant log are useful release evidence, but do not change the current source contract.
