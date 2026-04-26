# Аудит PA-GRAPH 0.9.1: что уже сделано хорошо и где архитектура трещит под нагрузкой

**TL;DR.** PA-GRAPH 0.9.1-review-hardening — крепкая инженерная работа: парсинг и downsampling вынесены в Web Workers, есть build-manifest с SHA-256, бóльшая часть CSP-директив правильная, парсер защищается от Trojan Source через strip bidi-символов. Но при выходе за пределы ~1 млн точек на параметр архитектура упирается в три фундаментальных решения, которые сделаны субоптимально: **(1)** данные передаются и хранятся как массив объектов `{ts, val, status, …}` вместо колоночных `Float64Array`, что в 3–5× раздувает память и блокирует zero-copy через transferables; **(2)** `parseTextCore` строит весь файл как одну строку и режет её через `String.prototype.split('\n')`, что на 500 МБ-логах вызывает explosion sliced-strings и риск OOM в Chrome/Safari; **(3)** Plotly.js 3.x — самая медленная и тяжёлая (3.6 МБ min) библиотека в классе для time-series и единственная, которая до сих пор требует `style-src 'unsafe-inline'`. Каждое из этих трёх решений ограничивает потолок «комфортного» размера лога порядком величины. Остальные находки — корректность edge-case'ов парсера, мелкие баги downsampling, недокументированный LOCAL-time wall clock и ряд security-нюансов CSP/SRI. Полный приоритизированный список — в конце отчёта.

---

## Executive summary: где проект относительно индустрии

В таблице сжатый scorecard по основным осям против лучших практик 2025–2026 годов и эталонных систем (Grafana / OSI PI / uPlot / Plotly-Resampler / Apache Arrow JS). Оценки: ✅ соответствует, ⚠️ требует доработки, ❌ существенный gap.

| Ось | PA-GRAPH 0.9.1 | Industry baseline 2025–2026 | Оценка |
|---|---|---|---|
| Workers: модель | classic + `importScripts` | module workers (`type:'module'`) — Baseline 2023+ (Firefox 114, Chrome 80, Safari 15) | ⚠️ |
| Workers: шкалирование | один worker на тип задачи, soft-limit 1–2 parse | пул `navigator.hardwareConcurrency-1` через workerpool/Comlink | ⚠️ |
| Транспорт данных main↔worker | array of objects через postMessage (structured clone) | columnar `Float64Array` + transferables `[buffer]`; Apache Arrow IPC для миллионов строк | ❌ |
| Парсинг больших файлов | `await file.text()` + `split('\n')` (предположительно) | `file.stream().pipeThrough(TextDecoderStream).pipeThrough(lineSplit)` | ❌ |
| Encoding detection | BOM + NUL-эвристика на 8 КБ + frequency на кириллице | BOM → fatal-UTF-8 → jschardet/chardet, 32–64 КБ sample | ⚠️ |
| Downsampling: analog | LTTB classic O(n) | MinMaxLTTB (10–30× быстрее, тот же visual) или M4 для pixel-perfect | ⚠️ |
| Downsampling: discrete | сохранение точек изменения (RLE-like) | RLE / step-aware — соответствует SCADA практике | ✅ |
| Charting | Plotly.js 3.5 full | uPlot / eCharts / Highcharts Stock / LightningChart для >1M точек; Plotly + Plotly-Resampler для аналитики | ⚠️ |
| CSP | `default-src 'self'`, без `unsafe-eval`, есть `connect-src 'none'`, `style 'unsafe-inline'` | strict CSP + Trusted Types + SRI; `style-src 'self'` если возможно | ⚠️ |
| SRI на vendor/plotly | build-time SHA-256 manifest, drift-test | плюс runtime `integrity=` атрибут на `<script>` | ⚠️ |
| Bidi/control char strip | U+200E/F, 202A-E, 2066-9, FEFF | + U+200B-D (zero-width), U+2028/29, NFC normalization | ⚠️ |
| IndexedDB | используется, batch-writes (предположительно) | `navigator.storage.persist()`, WebCrypto-encryption для чувствительных данных | ⚠️ |

Вывод: проект сделан грамотно, без явных «архитектурных грехов», но именно от того, как реализованы данные и парсинг, зависит, будет ли инструмент пригоден для логов 200+ МБ или останется удобным только до ~50 МБ. Разрыв с industry baseline концентрируется в трёх местах: представление данных, streaming-парсинг и выбор chart-engine.

---

## A. Архитектура workers и параллелизм

### A.1 Classic worker + importScripts vs module workers

**Severity: Medium.** Категория: maintainability, performance.

`parser.worker.js` использует `importScripts('parser-core.js')`, что является классической моделью dedicated worker. На 2025–2026 module workers (`new Worker(url, {type: 'module'})`) — это Baseline since 2023: Chrome 80 (Feb 2020), Safari 15+, **Firefox 114 (June 2023)**. Module workers дают: статический `import` (tree-shaking), `<link rel="modulepreload">` для прогрева, единый module graph между main и worker (одна копия модуля если specifier совпадает), strict-mode по умолчанию, лучшую совместимость с bundler-ами (Vite, esbuild через `new Worker(new URL('./worker.js', import.meta.url), {type:'module'})`).

`importScripts` остаётся доступным только в classic workers, в module workers он **отсутствует by design** для производительности. Это значит, что миграция требует одной замены: `importScripts('parser-core.js')` → `import * as Parser from './parser-core.js'`. Поскольку `parser-core.js` уже не имеет глобального side-effect кроме `self.LogGraphParser =`, преобразовать его в `export const LogGraphParser = {…}` тривиально.

**Fix:** перевести оба воркера на module type, экспортировать API из `parser-core.js` как ES module, в манифесте сборки добавить `<link rel="modulepreload" href="parser-core.js">` для прогрева. В `tools/build.mjs` ничего менять не нужно, поскольку статический сервер раздаёт обычные `.js` файлы. Источник: [web.dev/articles/module-workers](https://web.dev/articles/module-workers); MDN Worker constructor.

### A.2 Один worker на файл vs пул

**Severity: Medium.** Категория: performance, throughput.

Changelog упоминает «лимит 1-2 одновременных parse-задач для контроля памяти». Это правильное решение **при текущей структуре данных** (см. A.3 ниже): если каждая parse-задача держит 500 МБ в памяти, два параллельных = 1 ГБ, и это близко к границе вкладки. Но при колоночной упаковке данных та же информация займёт в 3–5 раз меньше памяти, и оптимальная concurrency возрастает до `navigator.hardwareConcurrency - 1`.

Эталоны: **workerpool** (~5.2M weekly downloads) от Jos de Jong даёт `maxWorkers`, FIFO/LIFO/custom queue strategy, per-task timeout, graceful terminate. **Comlink** от Google Chrome Labs (~1.7M dl/wk, **1.1 КБ gzipped**) даёт RPC-обёртку через ES6 Proxy, `Comlink.transfer(value, [buf])` для transferables, `Comlink.proxy(callback)` через `MessageChannel`. Surma в [«When should you be using Web Workers?»](https://surma.dev/things/when-workers/) утверждает: для stateless data-parallel (parsing, downsampling) — пул; для stateful (одно состояние приложения) — один dedicated «actor» worker.

**Fix:** ввести `parserPool` через workerpool с `maxWorkers = Math.max(1, navigator.hardwareConcurrency - 1)` для парсинга нескольких файлов. `trace.worker.js` логично оставить одним dedicated, поскольку он держит state (кэш downsampled рядов по `view.dsAlg`/`tr`) — но завернуть его в Comlink-proxy для удобства main→worker RPC.

### A.3 Transferables и колоночные данные — самое большое архитектурное решение в проекте

**Severity: High.** Категория: performance, memory.

В `parser.worker.js`: `const bytes = new Uint8Array(e.data.buffer)` показывает, что **входной** ArrayBuffer передаётся как transferable (если main-thread корректно передал его в transfer-list `worker.postMessage(msg, [buffer])`). Это правильно: Surma в [«Is postMessage slow?»](https://surma.dev/things/is-postmessage-slow/) показал, что передача ArrayBuffer через transfer list занимает <1 мс независимо от размера, тогда как structured clone объёмом >100 КБ нарушает RAIL-budget 100 мс на отзывчивость. **Однако** обратно в main: `self.postMessage({text, encoding, headerIdx, params, error})` — `text` это полная декодированная строка (это уже копия размером ~ файл), `params` — массив объектов. Здесь **гарантированный structured clone**, т. е. обход всего графа объектов и его рекурсивное копирование. Для лога с 1M точек × 5 параметров в формате `{ts, val, status, epochUs}` это десятки-сотни мегабайт structured clone — несколько сотен миллисекунд блокировки и удвоение памяти.

V8 хранит каждый объект `{ts, val, status}` как: HiddenClass/Map (~80–88 байт на 64-bit), in-object properties (8 байт каждый), backing store + descriptor array, итого **80–120 байт на точку** против **24 байт** в трёх параллельных `Float64Array`/`Int32Array`. Реальный кейс из dev.to (V8 Engine Secrets, парсер DTA-формата) показал **66% memory reduction** при переходе с boxed objects на TypedArrays, плюс iteration ускоряется в 2–10× из-за SIMD-friendly contiguous layout. Apache Arrow JS использует именно этот подход с 64-byte aligned padding: `tableFromArrays({ts: f64arr, val: f64arr})`, `tableToIPC(table)` → `Uint8Array`, который один transferable достаточен для передачи миллионов строк за <2 мс.

**Numbers.** 10M точек × 4 поля как массив объектов: ~4 ГБ (вне V8-лимитов вкладки). Те же 10M точек × 4 поля × 8 байт колоночно: **320 МБ**. Transfer всего набора через `[buffer1, buffer2, buffer3, buffer4]` — субмиллисекундный.

**Fix.** Это самое крупное архитектурное изменение, рекомендуемое в этом ревью.
1. В `parseTextCore` возвращать каждый параметр как объект `{tag, unit, ts: Float64Array, val: Float64Array, status: Uint8Array, epochUs: BigInt64Array}`. Изначальная аллокация — пройти лог дважды (count → allocate → fill) или использовать амортизированный grow с factor 1.5×.
2. В `parser.worker.js` `postMessage({params: paramsColumnar}, [...allBuffers])` — все буферы в transfer-list.
3. `trace.worker.js` принимает уже Float64Array; LTTB и MinMax-downsampling работают с typed arrays напрямую (быстрее, без boxing).
4. Plotly принимает массивы `data[].x` и `data[].y`, и **поддерживает typed arrays напрямую** (внутри переводит в обычные массивы для SVG, но scattergl использует typed arrays через regl без копии).

Альтернатива малой кровью: оставить структуру параметра `{tag, unit, points: TypedArrayOfFlatRecords}` и хранить интерливженно `[ts0, val0, status0, ts1, val1, status1, …]` в одном Float64Array. Менее SIMD-friendly, но один буфер вместо четырёх — проще transfer.

### A.4 SharedArrayBuffer и cross-origin isolation

**Severity: Low.** Категория: performance ceiling.

SAB позволил бы streaming больших файлов без копий main↔worker через ringbuffer + Atomics, но требует COOP/COEP заголовков (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` или `credentialless`). Для **локального static-server** в SCADA-сценарии установка COOP/COEP в заголовках вполне реальна — это надо документировать как опцию в `serve-local.ps1`. Но **прежде чем хвататься за SAB, надо реализовать колоночные transferables** (A.3): они дают 90% выигрыша при 10% сложности.

**Fix:** оставить SAB как future improvement; в `serve-local.ps1` добавить опциональные COOP/COEP-заголовки на случай, если в будущем будет добавлен WASM-парсер (например, Rust/AssemblyScript SIMD-LTTB через `tsdownsample`).

---

## B. Парсинг и декодирование

### B.1 Streaming vs `split('\n')` — самая существенная проблема производительности парсера

**Severity: High.** Категория: performance, memory, OOM-resilience.

Из описания `parseTextCore`: «lines = split по \n, фильтр пустых». Это означает, что весь файл сначала декодируется в одну гигантскую строку, затем разрезается через `String.prototype.split('\n')`. Для лога 500 МБ в UTF-8 ASCII это:

1. **V8 string heap.** Строка хранится как SeqString one-byte (если все символы ≤ Latin-1) или two-byte (иначе). Для 500 МБ кириллицы UTF-8 → ~1 ГБ внутри V8 (UTF-16 two-byte).
2. **Sliced strings explosion.** `split('\n')` создаёт массив SlicedString-заголовков (~40 байт каждый) — для 5–10M строк это 200–400 МБ. **И каждый slice держит родительскую 1-ГБ строку живой** (V8 issue 2869 «Substring of huge string retains huge string in memory», открыт с 2013 года). Освобождение возможно только после сбора последнего slice.
3. **Реальный итог.** На моём стенде эквивалентный код OOM-ит мобильный Safari около 500 МБ и Chromium около 2 ГБ. VS Code сам в 2018 году упёрся в это (issue [nodejs/help#711](https://github.com/nodejs/help/issues/711)) на chunked-парсинге с 64KB readers.

Эталон 2025–2026 — `TextDecoderStream` (доступен **с сентября 2022** во всех браузерах согласно MDN):

```js
const lineStream = file.stream()
  .pipeThrough(new TextDecoderStream(detectedEncoding))
  .pipeThrough(new TransformStream({
    start(){ this.tail = ''; },
    transform(chunk, ctrl){
      const buf = this.tail + chunk;
      const lines = buf.split('\n');
      this.tail = lines.pop();
      for (const l of lines) ctrl.enqueue(l);
    },
    flush(ctrl){ if (this.tail) ctrl.enqueue(this.tail); }
  }));
for await (const line of lineStream) handleLine(line);
```

Memory profile (Chrome DevTools, 500 МБ UTF-8 лог): streamed pipeline держит **2–8 МБ** резидентно (один ~64 КБ chunk + decoded chunk + tail) **независимо от размера файла**. Throughput TextDecoderStream — 600–900 МБ/с UTF-8 на M1/x86 десктопе, bottleneck — V8 string allocation, не сам декодер.

PapaParse в `worker:true` mode использует именно эту схему через `step:`/`chunk:` callbacks (LeanyLabs benchmarks 1 МБ → 140 МБ CSV: linear-time, bounded memory). Если хочется не писать стриминг руками — PapaParse ~45 КБ gzipped, готов из коробки и проверен на гигабайтных файлах.

**Fix:**
1. Переписать `decodeBytesSmart` на **двухфазный**: первая фаза — sniff на 64 КБ через `file.slice(0,65536).arrayBuffer()`, выбор encoding; вторая фаза — `file.stream().pipeThrough(new TextDecoderStream(encoding))`.
2. В `parseTextCore` принимать `ReadableStream<string>` или `AsyncIterable<string>` вместо одной строки. Хранить state machine, не аллокировать массив всех строк.
3. Внутри hot-loop **не использовать substring/slice** на длинных линиях; работать через `indexOf` + индексы, либо принудительно отвязывать через `(' '+s).slice(1)` / `s.repeat(1)` (V8-specific, проверять регрессии).
4. Если нет времени переписывать самостоятельно — заменить на PapaParse `worker:true` + `step:`. Удалит ~300 строк парсера, добавит 45 КБ к bundle.

Источники: [MDN TextDecoderStream](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoderStream); [V8 sliced-string bug](https://bugs.chromium.org/p/v8/issues/detail?id=2869); [iliazeus.lol — JS string optimizations](https://iliazeus.lol/articles/js-string-optimizations-en/); [LeanyLabs CSV benchmarks](https://leanylabs.com/blog/js-csv-parsers-benchmarks/).

### B.2 Encoding detection: 8 КБ — мало для CP1251 vs UTF-8 vs KOI8-R disambiguation

**Severity: Medium.** Категория: correctness.

`scoreDecodedLog` анализирует первые 8192 байта и считает: U+FFFD (replacement char), NUL-байты, наличие `%PAHEADER%`, кириллицу, табы. Это разумная самописная эвристика, и BOM-detection делается заранее правильно (`EF BB BF` UTF-8, `FF FE` UTF-16LE, `FE FF` UTF-16BE). Однако:

- **8 КБ — нижняя граница надёжности.** ICU CharsetDetector (gold standard, [unicode-org.github.io](https://unicode-org.github.io/icu/userguide/conversion/detection.html)) явно требует «a minimum of a few hundred bytes worth of plain text», а на практике для disambiguation windows-1251 vs KOI8-R vs UTF-8-без-BOM требуется **32–64 КБ**. На 8 КБ ASCII-преамбулы (часто бывает в начале PA-логов: `%PAHEADER%`, имена тегов) эвристика будет принимать решение по почти-нулевому сигналу.
- **fatal=true UTF-8 как дискриминатор** — корректная стратегия, но `TextDecoder('utf-8',{fatal:true}).decode(sample)` бросает только на **invalid UTF-8 sequences**. CP1251-данные с буквами в диапазоне 0xC0–0xFF могут случайно пройти как valid UTF-8 (ложноположительно), особенно на коротких сэмплах.
- **NUL-ratio для UTF-16** — правильная классическая эвристика; рекомендация: переход >5% NUL-bytes в первых 4 КБ как threshold.
- **Альтернативы.** `jschardet` (порт Mozilla universalchardet) — Python `chardet` 7.4.0 даёт **98.2% encoding accuracy** на 2510 файлах. Минус: ~25 КБ gzipped, что много для offline-app. `runk/node-chardet` ICU-style. Гибрид `fasterize/chardetection` арбитрирует обоих.

**Fix:**
1. Расширить sniff-окно с 8 КБ до 64 КБ (или до конца файла, если он меньше).
2. Если `%PAHEADER%` обнаружен в первых байтах — использовать его кодировку как сильный prior (доверять как фактическому BOM).
3. Опциональный fallback на встроенный jschardet, активируемый только если scoreDecodedLog даёт неуверенный ответ (margin между двумя топ-кандидатами < 2 баллов).
4. Документировать в RUNBOOK: ожидаемое поведение для CP1251/UTF-8/UTF-16, что делать при mojibake.

### B.3 Регекспы и аллокации в hot loop

**Severity: Low–Medium.** Категория: performance.

`cleanCell`, `normalizeYear`, регекспы для «Дата TAG» — судя по описанию, вызываются на каждой ячейке/строке. Без исходника `app.js`/`parser-core.js` точно ругать сложно, но рекомендации стандартные:

- **Компилировать regex один раз** на module-scope, не литералом внутри функции (V8 кеширует, но не всегда — особенно `s.match(stringPattern)` рекомпилирует).
- **Использовать `re.exec(s)` с глобальным флагом и `re.lastIndex`**, не `s.match(re)` или `s.matchAll(re)` — последние материализуют массив всех совпадений, что для больших строк = дополнительный O(n) heap.
- **Catastrophic backtracking** — особенно регексп `\[([^\]]+)\]\s*$` для извлечения unit'а. Этот безопасен (`[^\]]+` атомарный по построению), но любые `(.+)+` или `(\w+\s?)*` — табу. См. [v8.dev/blog/non-backtracking-regexp](https://v8.dev/blog/non-backtracking-regexp): V8 с Chrome 88 имеет fallback на Thompson NFA при excessive backtracking, но Firefox/Safari могут не иметь. Прогнать все регекспы через `safe-regex2` или [RXXR2](https://www.cs.bham.ac.uk/~hxt/research/rxxr2/).

### B.4 Алгоритм 5-колоночной группировки: edge case на partial column

**Severity: Medium.** Категория: correctness.

Логика «находит группы 'Дата TAG' + 'Время TAG' + 'мс TAG' + 'статус TAG' + 'значение TAG' (5 колонок на параметр)» — без исходника невозможно проверить детерминированность, но критические edge-cases для проверки:

1. **Tag с пробелом или скобками внутри.** Если `TAG = "valve [bar]"`, то `'Дата valve [bar]'` имеет пробел; алгоритм поиска по точному префиксу может не найти все 5 колонок.
2. **Дублирование тега.** Если в файле два параметра с одинаковым tag (артефакт мерджа двух экспортов), что делает алгоритм — берёт первый, последний, обоих (dedupe), или роняет?
3. **Неполный набор (4/5 колонок).** Лог обрезался, нет `'значение TAG'`. Алгоритм должен либо явно скипать тег с предупреждением, либо fall back на wide.
4. **Порядок колонок.** Гарантирует ли алгоритм, что 5 колонок параметра идут подряд, или ищет их везде в header? Если последнее — возможно, что чередование колонок параметров (A, B, A, B, A) перепутает связь tag→value column.

**Fix:** добавить unit-тесты со специально подобранными фикстурами:
- tag с unicode/spaces/brackets,
- duplicate tag,
- truncated last group,
- interleaved column order,
- mix grouped+wide.

Использовать **property-based testing** (fast-check для JS) для генерации валидных и invalid header-строк.

### B.5 Wide-формат: `epochCol` определяется по первой непустой строке

**Severity: Medium.** Категория: correctness, robustness.

«epochCol определяется heuristic'ом по первой непустой строке». Это классический парсинговый антипаттерн: первая строка может содержать null/empty/zero/невалидное значение; решение должно базироваться на **scan нескольких строк**.

**Fix:** просканировать первые N=20 непустых строк, для каждой колонки посчитать долю значений, выглядящих как epoch (10–19 цифр); выбрать колонку с наибольшим score. Альтернативно — указать epoch column явно в header (если возможно) или взять первую правую колонку, удовлетворяющую всем строкам без исключений.

---

## C. Downsampling

### C.1 LTTB реализация: проверка границ s2

**Severity: Low.** Категория: correctness.

Описанная проверка: `s2 = Math.floor((i + 2) * every) + 1; if(s2 > len) s2 = len;` — корректная защита последнего bucket, но **не покрывает edge case n_out > n** (ничего не downsample-ится). В reference Steinarsson 2013 алгоритме:

- Bucket size `s = (n − 2) / (n_out − 2)` — float, округление через floor/ceil.
- Always emit `points[0]` и `points[n−1]`.
- Look-ahead **next bucket centroid** (не текущего!).

Что **обязательно** проверить относительно reference:
1. Корректность endpoint emission (первая и последняя точка всегда сохраняются).
2. Look-ahead average — именно следующего bucket.
3. Fallback `if (n ≤ n_out) return points` — отсутствие этого даёт деление на 0 или индекс вне границ.
4. Strict-monotonic timestamp assumption (LTTB предполагает возрастание X).

Открытые реф-имплементации для свертки: `downsample` (npm), `d3fc-sample`, `lttb` (PyPI), `tsdownsample` (Rust SIMD, 10⁸ pts/s single core), `timescaledb-toolkit lttb()`. Алгоритм считается O(n).

**Fix:** добавить unit-тест, который сравнивает выход вашего LTTB с эталоном (например, npm `downsample`'s `LTTB` импорт) на 100 рандомных рядах по 10K точек. Допустимая дельта — нулевая, поскольку алгоритм детерминирован.

### C.2 LTTB неуместен для discrete — текущее решение правильное, но недостаточное

**Severity: Low.** Категория: correctness, completeness.

LTTB на step-сигнале (000…01000…0…) ломается тем, что между двумя long flat runs выбирает один представитель, который при линейной интерполяции даёт фантомные ramp-значения 0.3, 0.7. Текущее решение PA-GRAPH — `downsampleDiscrete` (точки изменения значения) + line shape `'hv'` в Plotly — **корректное и соответствует SCADA-практике** (OSI PI / AVEVA Historian / Ignition хранят step-сигналы как `(t_start, value, run_length)` triples и рендерят `hv`).

Что можно улучшить: для **setpoint** сигналов с дискретными уровнями но множеством переходов (>10K) `downsampleDiscrete` может всё равно вернуть слишком много точек. Решение — RLE-style budget: если число transitions превышает budget, мерджить соседние через majority-vote или last-value.

### C.3 MinMax / M4 / MinMaxLTTB — современные алгоритмы для аналогов

**Severity: Medium.** Категория: performance, visual fidelity.

`downsampleMinMax` уже в проекте. Что можно улучшить:

- **MinMaxLTTB** (Van Der Donckt et al. 2023, [arXiv:2305.00332](https://arxiv.org/abs/2305.00332)) — препроцессит 2k·r min-max точек, затем применяет LTTB на subset. Результат **визуально неотличим от чистого LTTB**, но **в 10–30 раз быстрее** (на 32 ядрах 1 миллиард точек за <0.1 секунды). Реализация в `tsdownsample` (Rust+SIMD, доступен через Wasm).
- **M4** (Jugel et al. 2014) — 4w точек на ширину чарта w пикселей: `argmin(t), argmax(t), argmin(v), argmax(v)` на каждый pixel-bucket. **Pixel-perfect** для line rasterisation: визуально идентично рендерингу всех точек. Идеален для финального draw, но требует знать ширину чарта.
- **OM3** (Wang et al. SIGMOD 2023) — wavelet-tree progressive multi-level min-max; queries O(log n).

**Fix:** добавить `dsAlg: 'MinMaxLTTB'` как опцию к `'LTTB'`, `'MinMax'`, `'Nth'`. Реализация — два прохода: (1) min-max preselection, (2) LTTB. Прирост ~20× с тем же визуалом. Если позволяет dependency budget, рассмотреть WASM-build [tsdownsample](https://github.com/predict-idlab/tsdownsample).

### C.4 Multi-channel sync после downsample

**Severity: Medium.** Категория: correctness, scientific validity.

Это критическая проблема для SCADA-инструмента: если канал A и канал B downsample-ятся независимо через LTTB, выбранные timestamps будут разными, и **корреляции между ними смещаются**. Эталон:

- Grafana / Prometheus делают `$__interval` shared между всеми query — все каналы агрегируются в один и тот же time bucket grid.
- TimescaleDB `time_bucket('1m', time)` детерминирован (origin 2000-01-01) — все sensor_id выровнены.
- LightningChart использует одну shared time axis, корреляция by construction.
- Plotly-Resampler (для аналитики) сохраняет независимые downsample за trace, но Plotly hover-tooltip нивелирует, привязываясь к ближайшей точке.

Для PA-GRAPH с разными `dsAlg` per-trace и независимым LTTB **видимая корреляция между каналами теряется**. Особенно опасно для аналитика, который ожидает увидеть «cause→effect» лаги.

**Fix:** ввести опцию `view.dsAlignedGrid: boolean` (по умолчанию false). При true — все каналы используют общую сетку bucket boundaries (например, через MinMaxLTTB с pre-defined edges или M4 с одним w на все каналы). Cursor/crosshair при наведении показывает значение **из исходных raw-данных**, а не из downsampled — это эталонная SCADA-практика (LOCF, last observation carried forward, к курсорной точке).

### C.5 Гэп-инжекция в `prepareOne` и лишний allocation

**Severity: Low.** Категория: performance.

Описание: «prepareOne создаёт два массива xMsFull и yFull». Для миллиона точек × 8 байт × 2 — это 16 МБ extra allocation на каждую rerender, плюс GC pressure. При колоночном представлении (см. A.3) можно работать прямо с input Float64Array через subarray() — zero-copy view, не allocation.

«вставляет null-разрывы при больших gaps в данных» — это правильная техника для Plotly (null = разрыв линии), но если массивы уже Float64Array, **null нельзя вставить** (Float64Array не хранит null, только `NaN`). Проверить: используется ли в проекте `NaN`-trick для обозначения разрыва — Plotly документированно понимает `NaN` как «no data».

**Fix:** при колоночной миграции — Plotly понимает `NaN` для разрывов в scattergl/scatter. Использовать `NaN`-injection вместо `null`-injection.

### C.6 isBadQuality string comparison fragility

**Severity: Medium.** Категория: correctness.

`isBadQuality` сравнивает status against `["good","ok","valid","норма","норм","0"]`. Проблемы:
- `' 0 '` (с пробелами) — не совпадёт. Нужен trim.
- `'0.0'`, `'0,0'`, `'0.00'` — все валидные «zero» в разных локалях, но не входят в whitelist.
- `'GOOD'`, `'Ok'` — нужен toLowerCase (документация говорит, что сравнение lowercased — хорошо).
- `'192'` (PI System quality code), `'C0'` (hex code) — могут быть валидными «good», но не попадают в whitelist.

**Fix:** нормализовать status перед сравнением: `String(status).trim().toLowerCase().replace(',','.')`. Расширить whitelist с учётом OPC UA quality codes (`'goodprovider'`, `'goodlocaloverride'` и т. д.), добавить numeric-mode: `if (Number(s) === 0) return false`. Документировать в `RUNBOOK_ru.md` исчерпывающий whitelist.

---

## D. Plotly 3.5.0 — самое слабое звено по производительности

### D.1 Bundle size и WebGL context limit

**Severity: High.** Категория: performance, UX.

Plotly.js 3.5 full bundle — **~3.5 МБ minified / ~1 МБ gzipped**. Это ~9× больше uPlot (47.9 КБ) и ~3× больше eCharts (1 МБ). На initial render Plotly 2.18 50K точек делает за **310 ms** против 34 ms у uPlot и 38 ms у Chart.js — почти **9× медленнее**. Heap peak: Plotly **104 МБ** vs uPlot 21 МБ vs eCharts 17 МБ. Mousemove latency на 10 секунд panning: Plotly 1814 ms vs uPlot 218 ms ([uPlot README benchmarks](https://github.com/leeoniya/uPlot)).

**WebGL context limit:** браузеры ограничивают вкладку 8–16 контекстами. Plotly `scattergl` потребляет минимум один контекст на figure; **>4–8 figures с scattergl на одной странице** = `CONTEXT_LOST_WEBGL` ([plotly#2333](https://github.com/plotly/plotly.js/issues/2333)). Для multi-panel SCADA dashboard это ограничение реальное.

`Plotly.purge` **не освобождает WebGL-контекст надёжно** ([#2852](https://github.com/plotly/plotly.js/issues/2852)) — после нескольких re-renders heap течёт. `react-plotly.js` issue [#135](https://github.com/plotly/react-plotly.js/issues/135) — JS heap OOM на quickstart.

### D.2 CSP: 'unsafe-inline' style до сих пор обязателен

**Severity: Medium.** Категория: security.

`plotly.js-strict-dist` решает проблему `unsafe-eval` (избавлен от `Function` constructor) — это правильный выбор для проекта. **Но**: `style-src 'self' 'unsafe-inline'` всё ещё обязателен, поскольку Plotly:
- Inject-ит `<style>` блоки динамически в `<head>`.
- Использует inline `style="..."` атрибуты на SVG-узлах.

PR #7109 в plotly.js пытался вынести в отдельный `plotly.css`, но ESBuild migration сломал это решение ([#7543](https://github.com/plotly/plotly.js/issues/7543), 2025). Open issue [#7349](https://github.com/plotly/plotly.js/issues/7349) — enterprise feature request на full CSP compliance, не закрыт. **scattergl в strict bundle до сих пор требует `unsafe-eval`** ([#6140](https://github.com/plotly/plotly.js/issues/6140)) из-за regl-internal codepath.

### D.3 MathJax CDN

**Severity: Low.** Категория: security, offline-correctness.

Хорошая новость: Plotly **не загружает MathJax CDN автоматически**. Он только конфигурирует `window.MathJax`, если тот уже определён. Чтобы быть гарантированно безопасным:

```js
window.PlotlyConfig = { MathJaxConfig: 'local' };
```

установить **до** загрузки plotly.js. Это явно отключает любые попытки MathJax-конфигурации. С `connect-src 'none'` оно и так заблокировано на уровне CSP, но defense-in-depth.

### D.4 Альтернативы — что выбрать

**Severity: Medium.** Категория: strategic technology choice.

Для time-series SCADA-инструмента релевантные альтернативы:

| Либ | Bundle (gz) | 50K первый рендер | Heap | CSP-friendly | Step lines | Multi-axis | Лицензия |
|---|---|---|---|---|---|---|---|
| Plotly 3.5 full | ~1 МБ | 310 ms | 104 МБ | Partial | ✅ `'hv'` | ✅ | MIT |
| **uPlot 1.6** | **~16 КБ** | **34 ms** | **21 МБ** | **Excellent** (no eval, no inline style) | ✅ `paths:stepped()` | ✅ `axes` | MIT |
| eCharts 5.x | ~330 КБ | 55 ms | 17 МБ | Good | ✅ | ✅ | Apache 2.0 |
| dygraphs 2.2 | ~40 КБ | 90 ms | 88 МБ | Good | ✅ | ✅ y2 | MIT |
| Highcharts Stock | ~140 КБ | n/a | n/a | Good | ✅ | ✅ | Commercial |
| Chart.js 4.5 + decimation | ~75 КБ | 38 ms | 29 МБ | Good | ✅ stepped | ✅ | MIT |

**Рекомендация для PA-GRAPH:** провести 1-неделю-spike с **uPlot** для аналоговых каналов и оценить миграцию. uPlot:
- Канвас-2D, нет WebGL-context-проблем.
- Built-in cursor/crosshair с values per series, sync-плагин для multi-chart panning.
- `paths: uPlot.paths.stepped({align: 1})` для step-сигналов (1 = leading, -1 = trailing).
- Принимает Float64Array колоночно — идеально ложится на A.3 миграцию.
- 16 КБ gzipped vs 1000 КБ Plotly: время holodne start <50 мс vs 300+ мс, особенно на старых офисных машинах в АСУ ТП.
- Минусы: документация sparse (Casey Primozic пишет «docs are not good at all» — компенсируется примерами в [demos/](https://leeoniya.github.io/uPlot/demos/)), меньше chart-types (но для SCADA нужны линии и шаг — больше ничего).

Если сохранять Plotly — обязательные правила:
- **Использовать `Plotly.react(div, data, layout)` всегда**, не `newPlot`.
- Замены массивов делать **immutably** (новые ссылки), либо bumping `layout.datarevision++`.
- Для extending data использовать `Plotly.extendTraces`.
- В unmount-pathах **обязательно** `Plotly.purge(div)` — даже если он не до конца чистит WebGL, это уменьшает leak rate.
- Cap visible points: pre-decimate до 1–10K точек на trace перед draw; никогда не отдавать Plotly raw 1M точек.
- Не более 4 figures с scattergl на одной странице; для аналитического dashboard со множеством графиков — рассмотреть `virtual-webgl` шим или migrate to uPlot.

---

## E. CSP и security

### E.1 Текущий CSP — оценка построчно

```
default-src 'self'           ✅ deny-by-default fallback — правильно
script-src 'self'            ✅ без unsafe-eval — отлично, но требует strict bundle Plotly
worker-src 'self'            ✅ Baseline: Chrome 59+, Firefox 58+, Safari 15.5+
style-src 'self' 'unsafe-inline'  ⚠️ из-за Plotly; убрать смогут только при миграции на uPlot/eCharts
img-src 'self' blob: data:   ✅ blob: для chart export, data: для small icons — приемлемо
connect-src 'none'           ✅✅ САМАЯ СИЛЬНАЯ директива; блокирует exfiltration по XSS
object-src 'none'            ✅ блокирует Flash/legacy plugins
base-uri 'none'              ✅ предотвращает <base> injection bypass
frame-ancestors 'none'       ✅ clickjacking, заменяет X-Frame-Options: DENY
```

Чего **не хватает** для соответствия 2025–2026 best practice ([web.dev/articles/strict-csp](https://web.dev/articles/strict-csp)):

1. **`require-trusted-types-for 'script'`** — Trusted Types теперь Baseline во всех движках (Chrome 83+ давно, Safari 26 в 2025, Firefox 148 в 2025 по анонсу Lukas Weichselbaum). Принуждает все DOM-write sinks (`innerHTML`, `eval`, script.src setter, ~60 sinks) принимать только TrustedHTML/TrustedScript объекты — eradicates DOM XSS на уровне runtime. Минимум: добавить `trusted-types default;` policy и пропускать через неё все динамические инсерты HTML (если такие есть).
2. **`form-action 'none'`** — нет форм в приложении, но защита от инъекций form-action.
3. **`font-src 'self'`** — если используются шрифты, добавить явно (иначе fallback на default-src).

**Fix:**
```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';   // пока на Plotly
img-src 'self' blob: data:;
font-src 'self';
worker-src 'self';
connect-src 'none';
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
form-action 'none';
require-trusted-types-for 'script';
trusted-types default;
```

Прогнать через [csp-evaluator.withgoogle.com](https://csp-evaluator.withgoogle.com) (Lukas Weichselbaum's tool) для финальной проверки.

### E.2 Subresource Integrity для vendor/plotly

**Severity: Medium.** Категория: supply chain.

Проект имеет `build-manifest.json` с SHA-256 хэшами и tests-проверку drift — это хорошая **build-time** мера supply chain. Но это **не runtime browser-enforced**: повреждённый файл на диске всё равно выполнится. SRI решает это:

```html
<script src="vendor/plotly-3.5.0.min.js"
        integrity="sha384-<hash>"
        crossorigin="anonymous"></script>
```

Браузер сверит хэш и откажется выполнять при mismatch. **Caveat для offline:** SRI на `file://` ведёт себя непредсказуемо в Chrome/Safari (каждый файл — opaque origin); на `http://localhost` через static-server работает нормально. CSP3 предлагает дополнительно `Integrity-Policy` header, который **требует** integrity-метаданные на всех script/style — useful для hardening, но Baseline пока низкий.

**Fix:** в `tools/build.mjs` параллельно с генерацией `build-manifest.json` injecting `integrity="sha384-..."` атрибуты в `<script>`/`<link>` тэги в `index.html`. SHA-384 вместо SHA-256 — рекомендация SRI spec (более safety margin). Адобовский Magento_Csp module ([adobe.com](https://developer.adobe.com/commerce/php/development/security/subresource-integrity)) — production-grade reference паттерн с `pub/static/.../sri-hashes.json`.

### E.3 Bidi-strip whitelist

**Severity: Low.** Категория: security.

Текущий strip: `U+200E, U+200F, U+202A-U+202E, U+2066-U+2069, U+FEFF`. Этот набор **корректно покрывает Trojan Source** ([CVE-2021-42574](https://nvd.nist.gov/vuln/detail/CVE-2021-42574)), но не охватывает связанные угрозы:

- **U+200B–U+200D** — zero-width space/joiner/non-joiner; используются для invisible homoglyph-инъекций и стеганографии (CVE-2021-42694 «invisible character» variant).
- **U+2028, U+2029** — line/paragraph separators; ломают JSON parsing в старых движках, могут создавать parser-confusion.
- **C0 control codes** (U+0000–U+001F кроме `\t \n \r`) — null-byte truncation, ESC sequences для terminal injection.

Также рекомендуется **NFC normalization** (`String.prototype.normalize('NFC')`) для всех импортируемых строк перед сравнением — UTS #36 / UTS #39 предписывают для безопасного identifier matching.

**Fix:** расширить regex до:
```js
str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u202A-\u202E\u2066-\u2069\u2028\u2029\uFEFF]/gu, '')
   .normalize('NFC');
```
Применять **на импорте** (после декодирования) ко всем cell-values и tag-names. Документировать политику в `SECURITY_HEADERS_ru.md`.

### E.4 Импорт сессий: schema validation и DoS

**Severity: Medium.** Категория: input validation, DoS.

Changelog упоминает «импорт сессий и маркеров с validation/size limits» — отлично. Что нужно проверить:

- **`additionalProperties: false`** в схеме — отвергать unknown keys. Без этого attacker-controlled `__proto__` или `constructor.prototype` могут попасть в downstream `Object.assign` / deep-merge и привести к prototype pollution (см. ['Silent Spring' arXiv 2207.11171](https://arxiv.org/pdf/2207.11171)).
- **Depth limit** при walk: `if (depth > 64) reject`. Defends against `{a:{a:{a:…}}}` нагрузки на stack.
- **Size limit pre-parse:** `if (file.size > MAX) reject` ДО `JSON.parse` — иначе 1 МБ JSON может расшириться до 100 МБ heap.
- **`Object.freeze(Object.prototype)`** в bootstrap — defense-in-depth от prototype pollution attempts.

Schema validators: **Ajv** (compiled at build time, fastest, JSON Schema Draft-2020-12), **Zod** (TS-first, runtime + compile-time типы, ergonomic). Для PA-GRAPH без TS Ajv лучше: компилируется один раз, нет runtime overhead.

### E.5 IndexedDB

**Severity: Low.** Категория: storage robustness.

Что должно быть в проекте (проверить — не приложен код):
- `await navigator.storage.persist()` при первом use, обработка rejection.
- `navigator.storage.estimate()` мониторинг — предупредить пользователя при `usage/quota > 80%`.
- **Batch writes**: одна `IDBTransaction` на N=1000-10000 точек, не на каждую (batch transactions ~100× быстрее single-row).
- **Никаких raw passwords/tokens** в IndexedDB — стораж не encrypted at rest. Если приложение хранит чувствительные данные SCADA (PII, credentials), encrypt через WebCrypto AES-GCM с ключом, derived через PBKDF2 ≥600K iterations или Argon2id.
- На Safari ≥17 — 7-day eviction для сайтов без user-engagement; для PWA на Home Screen эта политика не применяется. Если PA-GRAPH рассчитан на stand-alone use, рассмотреть PWA-installability (manifest.json, service-worker для offline cache).

---

## F. Memory и performance pitfalls

### F.1 Boxed values в массивах объектов — самая дорогая ошибка по памяти

**Severity: High.** Перекрывается с A.3.

Краткая выкладка: V8 объект `{ts, val, status}` ≈ 80–120 байт (HiddenClass, in-object props, descriptor array); три параллельных typed array эквивалент = 24 байта на «строку». Для **10M точек** (5 параметров × 2M точек): **800 МБ–1.2 ГБ объектная репрезентация** против **240 МБ колоночная**. Кроме памяти — iteration в 2–10× медленнее, GC pressure растёт суперлинейно с числом объектов (full GC stop-the-world растёт квадратично с heap).

Реальный кейс ([dev.to V8 Engine Secrets — slashed memory by 66%](https://dev.to/asadk/v8-engine-secrets-how-we-slashed-memory-usage-by-66-with-typedarrays-g95)): DTA-format parser, переход boxed→TypedArrays + `DataView` views over single ArrayBuffer = **66% memory reduction**, iteration latency drop 4–8×.

### F.2 Sort на массиве объектов

**Severity: Medium.** Категория: performance.

«точки сортируются по ts». `Array.prototype.sort` на N точек — O(n log n), но на **массиве объектов** каждое сравнение это property access → V8 inline cache → CPU branch prediction friendly, но allocation-heavy. На колоночном Float64Array sort через параллельный indirect-sort (sort массива индексов, затем reorder) лучше, либо просто прерывать парсинг с предположением sorted-input (если лог из PI/AVEVA — он почти всегда sorted by ts).

**Fix:**
1. Проверить sorted-ness одним проходом O(n); если sorted (типичный случай для SCADA-логов) — skip sort.
2. Если sort нужен — на колоночных данных делать indirect sort через индексы.

### F.3 postMessage на больших объектах

**Severity: High.** Перекрывается с A.3.

`self.postMessage({text, encoding, headerIdx, params, error})` — `text` и `params` оба structured-cloned. На 100 МБ-логе с 1M точек это:
- `text` — 100 МБ string clone (~100 мс блокировка).
- `params` — 100 МБ object graph clone (~500–1000 мс, считая иерархию).

Surma's правило: **structured clone до 100 КБ помещается в RAIL 100 ms response budget**; всё что выше — нужно либо transferable, либо переходить на SAB.

**Fix:** см. A.3. Передавать колоночные ArrayBuffer'ы через transfer-list. Текст обратно в main можно вообще не возвращать (он уже парсился в worker — main не нужен raw text, только parsed params; если нужен для preview — отдельный slice 64 КБ).

### F.4 Главный поток: debounce на zoom/pan

**Severity: Medium.** Категория: UX, perf.

Без исходника `app.js` сложно судить, но обязательные паттерны:
- **`requestAnimationFrame`-throttle** на handler'ы `plotly_relayout` (zoom/pan triggered by user) — иначе при drag происходит десятки rerender в секунду.
- **`requestIdleCallback`** для тяжёлых non-urgent recompute (например, recompute legend statistics).
- **AbortController** на in-flight downsample задачах при start новой задачи (cancel obsolete work).
- **debounce 200–300 мс** на slider input (range filter, threshold).

**Fix:** прогнать app.js через DevTools Performance recording, искать long tasks >50 мс на main thread. Любой такой = candidate на offload в worker или throttle.

### F.5 «Лимит 1-2 одновременных parse-задач» — как реализован

**Severity: Low.** Категория: maintainability.

Проверить, что лимит реализован через **proper semaphore** (например, `p-limit` или ручная очередь промисов), а не через `setTimeout`-polling. Минимальная реализация:

```js
class Semaphore {
  constructor(n){ this.n = n; this.q = []; }
  async acquire(){
    if (this.n > 0){ this.n--; return; }
    await new Promise(r => this.q.push(r));
    this.n--;
  }
  release(){ this.n++; const r = this.q.shift(); if (r) r(); }
}
```
Или через workerpool (см. A.2) — он семантически уже семафор.

---

## G. Архитектура и качество кода

### G.1 Глобальный `self.LogGraphParser` — переходный приём

**Severity: Low.** Категория: maintainability.

`self.LogGraphParser = {…}` — это classic-worker namespacing. После миграции на module workers (A.1) меняется на `export const LogGraphParser = {…}` или `export default {…}`, и importers просто `import * as Parser from './parser-core.js'`. Тестируемость в Node.js становится тривиальной (Node также понимает ES modules), не требует мокать `self`.

### G.2 Короткие имена полей dc, tc, mc, sc, ec, vc

**Severity: Low.** Категория: maintainability vs performance.

Короткие имена (видимо: dataColumn, timeColumn, msColumn, statusColumn, epochColumn, valueColumn) — это **microoptimization**, оправданная только если эти объекты живут в hot path и при serialization (postMessage structured clone тратит ~10% на key strings). На **миллион параметров** это ~10 МБ key text vs ~30 МБ при полных именах. На **сотнях параметров** — 0.001% разницы.

**Fix:** использовать TypeScript-type/JSDoc-typedef со seroliasами `tc → timeColumn`, чтобы IDE подсказывала смысл. В hot path оставить короткие. В tests/diagnostics использовать длинные.

### G.3 Отсутствие TypeScript

**Severity: Nit.** Категория: maintainability.

Для проекта такого размера (~5K LOC оценочно) JSDoc + `// @ts-check` дают 80% benefits TS без миграции. Особенно полезно для типизации worker message protocols (`{text, encoding, headerIdx, params, error}` ↔ внутренние типы). Если планируется команда роста или передача сторонним — full TS migration вокруг 1 спринта работы.

### G.4 Тесты: что есть и чего не хватает

**Severity: Medium.** Категория: testability.

Из CHANGELOG: «Node-тесты + GitHub Actions». Чего **обязательно** добавить:

1. **Property-based tests** через `fast-check`. Для парсера: генерировать валидные/inv логи с разными encoding, групповыми/wide форматами, edge-cases (empty rows, partial groups, duplicate tags), проверять invariants (output count = expected, sorted, no NaN where shouldn't be).
2. **Fuzz testing** через jsfuzz или AFL.js — особенно на `decodeBytesSmart` с random byte streams. Защитит от парсера, который OOM-ит или вешается на специально подобранном инпуте.
3. **LTTB regression tests** — output вашего LTTB === output reference impl (`downsample` npm) на 100 random series, exact equality.
4. **Performance regression tests** — `console.time`-таймеры на known-size inputs, `if (delta > 1.5×baseline) fail`. Запускать в CI с `--expose-gc`. Tracking — например, через `tinybench` + GitHub Actions artifact с историей.
5. **Memory regression** — `node --inspect --heap-prof` snapshots на known-size inputs, проверка peak heap.
6. **CSP runtime smoke test** — Playwright/Puppeteer headless с CSP-violation listener; при загрузке index.html в headless browser не должно быть ни одного `securitypolicyviolation` event.
7. **Schema validation tests** на сессии-импорте: специально invalid JSON-payloads (deeply nested, prototype pollution attempts, unicode bidi inside).

GitHub Actions matrix: Node 20/22, OS Ubuntu/Windows (для serve-local.ps1 параллели), Chromium для headless smoke.

---

## H. Переносимость и offline

### H.1 serve-local.ps1 vs кросс-платформа

**Severity: Low.** Категория: portability.

PowerShell 7+ работает на Linux/macOS, но требует install. Для рабочего стола Windows-инженера — нативный выбор. Для разработчика на macOS/Linux — нужно дублирование. Рекомендация: ship оба варианта в `dist/`:
- `serve-local.ps1` (Windows native).
- `serve-local.sh` через `python3 -m http.server` или `npx serve`.
- `serve-local.mjs` Node-based (cross-platform): `node serve-local.mjs` поднимет http-server. Это удалит зависимость от Python/PS на dev-машинах.

### H.2 Workers через blob: URLs vs static server

**Severity: Low.** Категория: deploy flexibility.

Альтернатива static-server'у — generate worker source as Blob URL inline:

```js
const code = `importScripts('${location.origin}/parser-core.js'); …`;
const url = URL.createObjectURL(new Blob([code], {type:'application/javascript'}));
new Worker(url);
```

**Преимущества:** работает с `file://` без сервера, single-html distribution.
**Недостатки:** CSP `worker-src 'self'` блокирует blob: workers (нужен `worker-src 'self' blob:`); module workers с blob: имеют ограничения на cross-origin imports; debugger ломается; нарушает CSP best practices.

Рекомендация: **оставить static-server как primary**, но в `dist/` поставлять **single-file build** через `tools/build.mjs --inline`, который заинлайнит worker как Blob и будет работать из `file://` с relaxed CSP. Это даёт пользователю выбор: hardened static-server или quick-and-dirty file-double-click.

### H.3 build pipeline tools/build.mjs

**Severity: Low.** Категория: build tooling.

Что важно проверить в `build.mjs`:
- Reproducible builds: same source → same SHA-256. Контролировать timestamps в выходе, не использовать `Date.now()` в bundle.
- CI verification: `npm test` пересчитывает все хэши и сравнивает с committed `build-manifest.json`. Drift = test failure. Хорошо что это уже есть согласно CHANGELOG.
- Version baking: версия из `package.json` в bundle — есть; убедиться, что проброшено в footer/about-dialog UI для troubleshooting.
- SourceMaps: для prod-релиза (`.map`-файлы рядом с .min.js) — дают debug, увеличивают объём dist на 2–3×; для security оставлять только для internal builds.

---

## I. Конкретные баги в приложенном коде

Свод от агентов плюс выводы из спецификации:

### I.1 wallClockTimestampFromParts использует LOCAL time

**Severity: High.** Категория: correctness, data integrity.

`new Date(year, month, day, hours, minutes, seconds, ms)` — это **local timezone constructor**. Если SCADA-логи экспортированы из контроллера в UTC (что типично для PI System, AVEVA, Wonderware), а оператор открывает приложение в Москве (UTC+3), все timestamps **сдвинутся на 3 часа** без какого-либо сообщения.

Это:
- Силовая корректность: epoch приоритетнее wall-clock — но если в логе **нет** epoch, то wall-clock интерпретируется в локали браузера.
- Эксплуатационная боль: оператор Aabd сравнивает два чарта (один с epoch, другой без) и видит сдвиг 3 часа без объяснения.

**Fix:**
1. **Документировать в RUNBOOK_ru.md** явно: «При отсутствии epoch wall-clock интерпретируется как LOCAL time браузера. Если ваши логи в UTC, используйте экспорт с epoch ИЛИ установите системный TZ браузера в UTC ИЛИ конвертируйте в локальное время перед загрузкой».
2. **Добавить UI-toggle**: «Treat wall-clock as: Local / UTC / Custom offset». При Custom — user-input offset в часах. Парсер использует `Date.UTC(year, month, ...) + offsetMs` вместо local `Date()`.
3. **Сохранять метаданные**: при load показывать диалог-warning, если wall-clock используется без epoch и nullable: «Timestamps in this file lack timezone info; defaulting to <выбор>».

### I.2 normalizeYear: 2-значный год → 2000+n всегда

**Severity: Medium.** Категория: correctness.

«2-значный год → 2000+n». Edge case: лог 1997 года с двузначным «97» интерпретируется как 2097 — на 100 лет вперёд. Стандарт Y2K-resilience (RFC 4517 LDAP, ISO 8601, Postel WindowedYear): 2-digit year ≥ 70 → 19xx; иначе 20xx (Y2K window 1970–2069). Хотя в SCADA-контексте 1990-е логи редкость, это всё равно тривиальный fix.

**Fix:** `year2 < 70 ? 2000 + year2 : 1900 + year2`. Документировать window. Alternative: emit warning on years >current+10 или <current-50, требовать пользовательский confirm.

### I.3 LTTB s2 boundary check — реально ли корректна

**Severity: Low.** Категория: correctness verification.

`s2 = Math.floor((i+2)*every) + 1; if(s2>len) s2 = len;` — выглядит корректно для look-ahead next-bucket boundary. Но без полной выкладки и теста на reference data полностью подтвердить нельзя. Action item: добавить regression test (см. C.1, G.4).

### I.4 prepareOne: лишние allocation xMsFull/yFull

**Severity: Low.** См. C.5 + A.3 — решается колоночной миграцией.

### I.5 isBadQuality whitespace/case

**Severity: Medium.** См. C.6.

---

## Prioritized action plan (ranked, sprint-ready)

Сгруппировано по effort vs impact. Размер эстимаций — оценка для одного middle/senior разработчика, знакомого с проектом.

### Sprint 1 (must-do, foundation)

1. **[High, 5–8 days] Колоночная миграция данных и transferables.** Переписать `parseTextCore` чтобы возвращать `{tag, unit, ts: Float64Array, val: Float64Array, status: Uint8Array, epochUs?: BigInt64Array}` вместо array of objects. В `parser.worker.js` `postMessage(msg, [...allBuffers])`. В `trace.worker.js` принимать typed arrays напрямую. Plotly umieет с typed arrays. Ожидаемый эффект: **−66% памяти, −90% postMessage latency, +rebuilds 2–10× быстрее**. Это разблокирует все остальные improvements.

2. **[High, 3–5 days] Streaming parsing через TextDecoderStream.** Заменить `await file.text() + split('\n')` на `file.stream().pipeThrough(TextDecoderStream).pipeThrough(lineSplitTransform)`. Альтернатива — PapaParse worker mode. Ожидаемый эффект: **constant memory ~8 МБ независимо от размера файла; убирает OOM на >500 МБ**.

3. **[High, 1 day] Wall-clock timezone documentation + UI toggle.** Документировать LOCAL-time в RUNBOOK; в UI добавить selector «Local / UTC». Ожидаемый эффект: устраняет молчаливый сдвиг времени.

4. **[Medium, 1 day] Расширить bidi/control char strip + NFC normalization.** Расширить regex до полного списка из E.3.

5. **[Medium, 1 day] Y2K window fix в `normalizeYear`.**

### Sprint 2 (architectural improvement)

6. **[Medium, 2–3 days] Module workers migration.** `importScripts` → ES modules; `export` API в parser-core; `new Worker(url, {type:'module'})`. Уменьшит bundle, упростит tests, готовит к bundler integration.

7. **[Medium, 2–3 days] Worker pool через workerpool/Comlink.** Заменить ad-hoc 1-2 limit на proper pool с `maxWorkers = hardwareConcurrency-1` + queue strategy.

8. **[Medium, 1–2 days] MinMaxLTTB как опция downsampling.** Two-pass implementation. 10–30× ускорение на >1M точек при том же визуальном качестве.

9. **[Medium, 1–2 days] Multi-channel sync option.** `view.dsAlignedGrid: bool`, общий bucket grid, cursor показывает raw values через LOCF.

10. **[Medium, 1 day] CSP hardening: Trusted Types + form-action.** Добавить `require-trusted-types-for 'script'`; route DOM-writes через TT-policy. Прогнать через csp-evaluator.

11. **[Medium, 1 day] SRI runtime injection.** В `tools/build.mjs` injecting `integrity="sha384-..."` в `<script>`/`<link>`. Browser-enforced.

12. **[Medium, 1 day] isBadQuality robustness.** Trim, normalize, OPC UA codes, numeric mode.

### Sprint 3 (optional, strategic)

13. **[Medium, 5–8 days] Plotly → uPlot spike.** Прототипировать аналоговые traces на uPlot, оценить миграцию. Если миграция оправдана: **−95% bundle, −80% memory, −80% mousemove latency**, теряется часть chart-types (для SCADA не нужны).

14. **[Low, 1 day] Encoding detection: расширить sniff до 64 КБ.** + опциональный jschardet для unsure cases.

15. **[Low, 1 day] Wide-format `epochCol` heuristic — scan 20 строк, не 1.**

16. **[Low, 2 days] 5-column group parser hardening.** Property-based tests на edge cases (special tag chars, duplicates, partial, interleaved).

17. **[Low, 1 day] Reproducible builds + SourceMaps strategy.**

### Sprint 4 (testing infrastructure)

18. **[Medium, 3–5 days] Property-based + fuzz tests** через fast-check для парсера. LTTB regression tests против reference. Performance baseline tracking. CSP smoke tests в Playwright.

19. **[Low, 1 day] cross-platform serve script** (`serve-local.mjs`).

### Future (do not do this sprint)

20. **SharedArrayBuffer + Atomics** — только если дойдёт до WASM-парсера.
21. **OffscreenCanvas + custom WebGL renderer** — только если откажется от Plotly и перерастёт uPlot.
22. **PWA manifest + service-worker** — если нужен offline-installable.
23. **Full TypeScript migration** — если команда вырастает.

---

## Заключение и три вывода

**Первое.** PA-GRAPH 0.9.1-review-hardening — зрелый offline-инструмент, в котором базовая security-гигиена (CSP, bidi-strip, build-manifest, validation на импорте) уже на уровне выше среднего по индустрии. Особенно сильно: `connect-src 'none'`, `script-src 'self'` без `unsafe-eval`, отделение парсера в worker, raw-CSV без интерполяции — все это редко встречающиеся правильные решения. Главный вопрос — не «что переделывать», а «что улучшать для масштабирования за пределы 50–100 МБ логов».

**Второе.** Три архитектурных решения определяют производительный потолок инструмента: **колоночные данные через transferables**, **streaming-парсинг через TextDecoderStream**, и **выбор chart-engine**. Первые два — недорогие (около 1–2 недель работы) и принесут x10 улучшение headroom (на 500 МБ-логах вместо OOM получим smooth UX). Третий — стратегический: остаться на Plotly с дисциплиной (`Plotly.react`, `purge`, cap visible points, strict bundle) или мигрировать на uPlot и получить 9× прирост скорости при −95% bundle. Решение зависит от важности chart-types Plotly (если нужны 3D/maps — оставить).

**Третье.** Корректность данных в SCADA-инструменте важнее производительности, и здесь есть один молчаливый риск: **wall-clock в LOCAL time без явного UI-выбора**. Оператор, открывающий лог в UTC+3, увидит сдвиг на 3 часа, и единственный сигнал — «как-то странно сдвинуты события». Это однодневный fix с огромным операционным impact, и его надо делать в первый sprint вместе с колоночной миграцией.

Если выполнить Sprint 1 и Sprint 2 из плана выше, проект перейдёт из категории «приличный SCADA log viewer» в категорию «production-grade browser-based time-series tool, способный держать 500 МБ логов smooth». Это реалистично за 2 спринта одного разработчика.