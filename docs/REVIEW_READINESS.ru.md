# Готовность к полному ревью

Этот документ фиксирует текущее состояние проекта перед очередным code/architecture review.

## Что проверять

- Исходники: `src/`, `tools/`, `tests/`, `vendor/`, `.github/`.
- Документацию: `README.md`, `docs/`, `review/`.
- Генерируемый runtime не ревьюить как source of truth: `build` пересобирается из исходников.
- Старый `log-graph-v091.html` не нужен и не хранится в Git.

## Команды

```powershell
npm test
```

Для ручной проверки:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve-local.ps1
```

Открыть `http://127.0.0.1:8765/index.html`.

## Что закрыто после последнего ревью

- Прямое открытие HTML больше не является штатным режимом; runtime требует статической раздачи, чтобы workers работали предсказуемо.
- Импорт больших файлов идёт через `File.stream()` в `parser.worker.js`, без полного чтения файла в main thread.
- Parser и main-state используют `ColumnarData`: `ts/val` хранятся в `Float64Array`, boolean-флаги в `Uint8Array`, строковые поля в dictionary-coded колонках.
- Worker возвращает результат парсинга колоночными typed arrays через transfer-list; main thread больше не хранит базовые точки как массив `{ts,val,...}` объектов.
- Полный raw text хранится только до 25 MiB; для больших файлов отключено сохранение исходника с переименованными тегами.
- Штатный `serve-local.ps1` включает COOP/COEP, поэтому parser worker может отдавать `SharedArrayBuffer`-backed колонки.
- `trace.worker.js` стал persistent worker-owned state: main регистрирует ряды по `dataId`, а prepare-запросы передают только id/meta/view. Для SharedArrayBuffer это zero-copy между main и worker без detach буферов.
- Для fallback без cross-origin isolation precompute по-прежнему передаёт cloned typed arrays через transfer-list; для очень больших выбранных наборов есть byte-guard, чтобы не удваивать сотни MiB памяти.
- Render/export/XY/statistics/session snapshot/unit conversion читают и пишут колонки напрямую, без временных point-object массивов.
- Merge сохраняет conflict-аудит, но базовые ряды после merge снова складываются в `ColumnarData`.
- Epoch хранится как абсолютный UTC instant; в UI и CSV добавлен переключатель Local/UTC. Логи без epoch остаются local wall-clock fallback, без неявного UTC.
- Sniff кодировки расширен до 64 KiB.
- Epoch-колонка wide-лога определяется по нескольким начальным строкам.
- Двузначные годы нормализуются по окну `00..69 => 2000..2069`, `70..99 => 1970..1999`.
- Добавлен `MinMaxLTTB`.
- Улучшена нормализация `status` quality.

## Сознательные tradeoff-ы

- Для снижения риска `ColumnarData` оставляет array-like API (`length`, индекс, `map/filter/some`, итератор). Этот API нужен для совместимости и тестов; производительные пути переведены на прямую работу с колонками.
- Plotly оставлен как chart engine из-за текущего набора функций. Миграция на uPlot/eCharts имеет смысл отдельным spike-проектом.
- Classic workers оставлены ради простого статического runtime без bundler. Module workers можно рассмотреть позже, но это не блокирует локальную эксплуатацию.
- Security hardening не является приоритетом проекта, если он ухудшает читаемость или производительность. Проект рассчитан на локальные доверенные логи.
- Для true zero-copy нужен cross-origin isolated HTTP runtime. Если проект раздать сервером без COEP, приложение автоматически откатится к transferable-клонам для trace precompute.

## Не блокирует текущее ревью

- Альтернативный chart engine для рядов больше миллиона точек на параметр остаётся отдельным продуктовым spike: текущий код больше не держит данные как object graph, но Plotly всё ещё определяет потолок интерактивной отрисовки.
- Бенчмарки памяти/скорости на синтетическом логе 500 MiB+ и реальном объектном логе полезны как release evidence, но не меняют текущий source-контракт.
