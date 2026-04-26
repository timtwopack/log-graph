
## TL;DR

Проект — оффлайн-графопостроитель SCADA/PLC-логов на vanilla JS + Plotly, предназначенный для статической раздачи `dist/server`. С момента ревью v3 (где основным P0 был «drift между app.js и инлайн-JS в `log-graph-v091.html`») главная проблема **закрыта**: HTML-шаблон теперь чисто `<script src="app.js"></script>`, build-манифест с SHA-256 и тест `assert.doesNotMatch(serverHtml, /function parseTextCore/)` гарантируют отсутствие inline-парсера. Сборка и тесты проходят: `npm test` → 19/19 за 99 мс.

Остаются содержательные, но не блокирующие замечания. Самое серьёзное — **тройное дублирование парсинга** (app.js ↔ parser.worker.js ↔ inline blob-fallback) без автоматической проверки синхронизации.

---

## 1. Архитектура

```
src/index.template.html  →  dist/server/log-graph-v091.html  (копируется как есть)
src/app.js               →  dist/server/app.js                (5808 строк, основной runtime)
src/styles.css           →  dist/server/styles.css
parser.worker.js         →  dist/server/parser.worker.js     (decode + parse в worker)
trace.worker.js          →  dist/server/trace.worker.js      (precompute downsample)
vendor/plotly-3.5.0.min.js → dist/server/vendor/...           (4.8 MB локальная Plotly)
build-manifest.json      (SHA-256 каждого исходника, гейт против drift)
```

Хранение: IndexedDB (`pagraph/sessions`) для сессий, `localStorage` для пресетов и маркеров. Никакого сетевого трафика. PowerShell `serve-local.ps1` поднимает однопоточный TCP-сервер с set безопасных заголовков (см. ниже).

State полностью собран в namespace `S` (8 групп: `ui`, `data`, `view`, `style`, `plot`, `cursor`, `markers`, `zoom`, `t0`, `anomaly`, `presets`, `runtime`) — разумное решение для большого vanilla-JS файла.

---

## 2. Сильные стороны

- **Build-манифест с SHA-256** ([tools/build.mjs:59](https://claude.ai/epitaxy/tools/build.mjs:59)) и тест против дрифта source ↔ server — **уже один раз спас проект** от «расходящихся правд», см. историю review v3.
- **Web Workers** для парсинга и precompute, с fallback-цепочкой: file:// → blob-script → main thread. Корректный путь для оффлайн-сценариев.
- **Plotly.react fast-path** ([app.js:3129](https://claude.ai/epitaxy/src/app.js:3129), [_renderChart](https://claude.ai/epitaxy/src/app.js:5338)) с правильной сигнатурой инвалидации `_computeRenderSig`. UX не «дёргается» при изменении сглаживания/цветов.
- **LRU-кеш `_ptdCache`** (64 записей, [app.js:4966](https://claude.ai/epitaxy/src/app.js:4966)) с ключом по `tag|len|TR|smooth|ds|cgaps|t0|anomaly|signalKind|quality`. Стиль (цвет/толщина) обновляется без пересчёта данных — хорошее решение.
- **Smart-decoding** ([decodeBytesSmart](https://claude.ai/epitaxy/src/app.js:832), [scoreDecodedLog](https://claude.ai/epitaxy/src/app.js:811)) — UTF-8/CP1251/UTF-16LE/UTF-16BE с эвристикой по NUL-байтам и доменным сигнатурам. Тесты подтверждают round-trip.
- **Зачистка bidi/control-символов** в импорте — реальная защита от испорченных данных.
- **Конфликты merge** ([mergeParsedParams](https://claude.ai/epitaxy/src/app.js:1361)) сохраняются и помечаются `mergeConflict`, экспортируются в raw-long CSV. Не «съедаются молча».
- **Жёсткая валидация импорта сессий/маркеров** ([validateSessionPayload](https://claude.ai/epitaxy/src/app.js:4487), [sanitizeMarkersArray](https://claude.ai/epitaxy/src/app.js:4469)): лимиты по числу параметров, точек, маркеров, длине строк, проверка форматов.
- **Защита PNG/HTML-инъекций** через `escapeHtml` для текста маркеров, попадающих в Plotly hovertext/annotations ([app.js:794](https://claude.ai/epitaxy/src/app.js:794)).
- **Path-traversal protection** в PS-сервере ([serve-local.ps1:82](https://claude.ai/epitaxy/local_c3d92fd0-b2ff-41bd-af05-a0713b879ccf)) через `GetFullPath` + `StartsWith($RootNorm)`. Корректно.
- **Persistent storage request** перед сохранением сессии (`navigator.storage.persist`), gzip-экспорт через `CompressionStream` с fallback.
- **Диагностический экспорт** без телеметрии — пользователь сам решает, что отдавать.
- **Подробная встроенная справка** (F1, [index.template.html:175](https://claude.ai/epitaxy/src/index.template.html:175)) — настоящее редкое явление в подобных тулзах.

---

## 3. Замечания

### P0 (стоит исправить до следующего релиза)

**3.1. Тройное дублирование парс-логики без enforcement-теста.**

Функции `stripImportedControlChars`, `cleanCell`, `stripBom`, `scoreDecodedLog`, `decodeWithLabel`, `decodeBytesSmart`, `normalizeYear`, `epochToMs`, `wallClockTimestampFromParts`, `timestampFromParts`, `shortNameFromTag`, `parseTextCore`, `headerIndexFromText` определены **в трёх местах**:

- [src/app.js:802-1357](https://claude.ai/epitaxy/src/app.js:802) — основной код;
- [parser.worker.js:3-214](https://claude.ai/epitaxy/local_c3d92fd0-b2ff-41bd-af05-a0713b879ccf) — точная копия;
- [src/app.js:1426-1453](https://claude.ai/epitaxy/src/app.js:1426) — `parserWorkerScript()` склеивает их через `.toString()` для blob-fallback при `file://`.

Аналогично `trace.worker.js` дублирует `downsampleDiscrete`, `downsample`, `downsampleMinMax`, `downsampleNth`, `dsDispatch`, `isBadQuality`, `isStepKind` из app.js.

Текущие тесты проверяют, что **каждая копия работает**, но не что **они идентичны**. При патче только в одном месте drift вернётся молча.

**Рекомендация:** в `tools/build.mjs` либо генерировать `parser.worker.js`/`trace.worker.js` из выделенных секций `app.js` (комментарии-маркеры `// region:parser-core` … `// endregion`), либо наоборот — конкатенировать в `app.js` из общего `src/parser-core.js`. Build-манифест уже умеет хешировать — добавить тест «SHA(вырезанная секция app.js) === SHA(parser.worker.js минус onmessage)».

---

### P1 (полезно, но без жёсткого SLA)

**3.2. `app.js` 5808 строк в одном файле.** Внутри: parsing, rendering, storage, markers, export, keyboard shortcuts, UI wiring. Навигация и code review страдают. Можно разбить на ESM-модули и склеивать в build.mjs (или просто конкатенировать `parts/*.js` без `import/export`). Связанная проблема — затратные имена (`hf`, `pn`, `gc`, `ft`, `ff`, `_fs`, `updTB`, `updSide`); хотя бы JSDoc-теги существенно облегчили бы чтение.

**3.3. Дублирование `if(back) back.disabled = …` в [app.js:4178-4179](https://claude.ai/epitaxy/src/app.js:4178).**

```js
if(back) back.disabled = S.zoom.ZOOM_POINTER < 0 && S.zoom.ZOOM_HISTORY.length === 0;
if(back) back.disabled = S.zoom.ZOOM_POINTER < 0;
```

Первая строка перетирается второй безусловно. Очевидный leftover refactoring — удалить первую.

**3.4. Версия в трёх местах рассинхронизирована.**

- [docs/CHANGELOG.md:3](https://claude.ai/epitaxy/docs/CHANGELOG.md:3) — `0.9.1-review-hardening`;
- [src/index.template.html:6](https://claude.ai/epitaxy/src/index.template.html:6) — `v0.9.0` (title и `<span class="ver">`);
- [src/app.js:260](https://claude.ai/epitaxy/src/app.js:260) — хардкод `version: '0.9.0'` в `exportDiagnostics`.

Должна быть одна константа в одном месте, остальное генерируется при build.

**3.5. Магические `setTimeout` для «осаждения» Plotly.** В коде разбросаны `40`, `60`, `80`, `90`, `160`, `200`, `400`, `500`, `600`, `800`, `900` мс ожиданий — все компенсируют асинхронность Plotly relayout/newPlot. На медленной машине и при больших датасетах эти константы могут «не доезжать». Например, [loadSession](https://claude.ai/epitaxy/src/app.js:4740) ждёт 900 мс, прежде чем восстановить zoomState — комментарий честно признаёт «render(80) + mk*(40) + newPlot(~200) + savedRange(500) с headroom». Реальный fix — chain promises от `Plotly.newPlot/react` (он возвращает Promise) вместо счётов в воздухе.

**3.6. Многопараллельный `Promise.all` в `parseFilesBounded`.** Решено наполовину: `chooseFileParseConcurrency` ([app.js:1501](https://claude.ai/epitaxy/src/app.js:1501)) ограничивает 1–2 файла, что хорошо. Но всё равно файл целиком читается в `ArrayBuffer`, далее в строку, далее в массив строк — для 250 МБ-логов это ~1 ГБ peak. Streaming-parser (chunked TextDecoder + по одной строке) был бы корректнее, но это уже большой refactor.

**3.7. `prompt()`/`confirm()` повсюду** — для имени сессии, имени пресета, удаления маркеров, переименования тегов. Блокирующие, в некоторых embed-сценариях недоступны. Это UX/feature, не баг, но просится единый модальный helper.

**3.8. Inline event handlers в HTML-шаблоне** (`onclick="togSidebar()"`, `oninput="setH(this.value)"` и т.д., десятки штук в [index.template.html](https://claude.ai/epitaxy/src/index.template.html)). [SECURITY_HEADERS.md:14](https://claude.ai/epitaxy/docs/SECURITY_HEADERS.md:14) сам же фиксирует, что из-за этого CSP вынужден держать `'unsafe-inline'`. Перенос на `addEventListener` — заметная работа, но открывает путь к по-настоящему строгой CSP.

---

### P2 (мелкие улучшения и потенциальные ловушки)

**3.9. `isBadQuality`** ([app.js:203](https://claude.ai/epitaxy/src/app.js:203)): любой непустой статус, не входящий в whitelist «good/ok/valid/норма/норм», классифицируется как bad — включая случайную строку `"42"`. Для PA-логов вероятно ОК (статусы — стандартизованные коды), но стоит документировать политику в коде или сделать список допустимых значений настраиваемым.

**3.10. `_zoomEntriesEqual`** ([app.js:4068](https://claude.ai/epitaxy/src/app.js:4068)) использует `Math.abs(a.r0 - b.r0) > 500` (мс) для дедупа истории. Для логов с мелким зумом (диапазон в секунды) 500 мс — это весь вьюпорт, дубли пропадут. Лучше сделать порог пропорциональным текущему range (например, 0.1%).

**3.11. `exportMarkersJSON`** ([app.js:3771](https://claude.ai/epitaxy/src/app.js:3771)) НЕ делает `document.body.appendChild(a)` перед `a.click()`, тогда как `exportSessionToFile` ([app.js:4789](https://claude.ai/epitaxy/src/app.js:4789)) делает. В Firefox без appendChild клик может игнорироваться. Хорошо бы единый helper `downloadBlob(blob, filename)`.

**3.12. `MARKERS` не очищаются на `resetAll()`.** Документировано в help-панели, но user может удивиться, видя маркеры из предыдущего файла на новом графике. Минимум — добавить кнопку «Очистить также маркеры» в `resetAll`.

**3.13. PowerShell-сервер однопоточный.** `AcceptTcpClient` → синхронная обработка → следующий клиент. Любой подвисший запрос (или просто медленный I/O на 5 МБ Plotly) блокирует параллельные. Для localhost-сценария ОК, но `serve-local.ps1` копируется в portable bundle ([make-portable.ps1:32](https://claude.ai/epitaxy/local_c3d92fd0-b2ff-41bd-af05-a0713b879ccf)), и пользователи могут запустить его на LAN. Минимально — задокументировать «strictly localhost, single-user», максимально — обернуть `Start-ThreadJob` или асинхронные сокеты.

**3.14. `StreamReader` с `Encoding.ASCII`** ([serve-local.ps1:106](https://claude.ai/epitaxy/local_c3d92fd0-b2ff-41bd-af05-a0713b879ccf)) для request-line. Не-ASCII в URL были бы потеряны, но браузер всегда percent-encodes — на практике безопасно. Тем не менее `UTF8` корректнее.

**3.15. CSP-рекомендация в `SECURITY_HEADERS.md`** покрывает `'unsafe-inline'` для script и style. Server (`serve-local.ps1:51-61`) **не отдаёт CSP вообще** — только COOP, CORP, X-Content-Type, Referrer-Policy, Permissions-Policy. Доп. recommended-CSP из SECURITY_HEADERS.md можно докинуть в локальный сервер за пять строк, чтобы dev-режим был ближе к prod.

**3.16. Имена ключей в localStorage без общего префикса:**

- `loggraph_presets`
- `loggraph_markers`
- `loggraph_annotations` (legacy)
- `pagraph_sessions` (legacy, мигрирует в IDB)

Раз бренд переехал из `loggraph` в `pagraph`, миграция презентов и маркеров под новый префикс упростила бы будущие операции (например, «удалить всё пользовательское состояние»).

**3.17. Sample только wide-формата с epoch.** [data_base/test_base.txt](https://claude.ai/epitaxy/data_base/test_base.txt) — единственный тестовый файл (47 КБ, wide TSV). Тестов через synthetic strings достаточно для unit-уровня, но для acceptance-чек-листа в [RUNBOOK.md:67-77](https://claude.ai/epitaxy/docs/RUNBOOK.md:67) полезно иметь 4–5 канонических sample-файлов: grouped, CP1251, UTF-16, c bad-quality, c merge-conflict.

**3.18. `prepareXYData`** ([app.js:1748](https://claude.ai/epitaxy/src/app.js:1748)) использует greedy «advance xi while next is closer» pairing, что O(N+M), но может промахнуться при немонотонных Y-сериях. Для типового SCADA-сценария (X = время, и Y тоже sampled по времени) это работает, но если X — это датчик с обратным ходом (давление, скорость падает), поведение неочевидно.

---

### P3 (стилистические нюансы)

- **`_safeFilename`** разрешает пробелы и заменяет их на `_`. Хорошо, но не учитывает зарезервированные имена Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`). На практике редко всплывает, но один из вариантов — добавить в regex.
- **`fileTS()`** ([app.js:2503](https://claude.ai/epitaxy/src/app.js:2503)) — формат `DD-MM-YY_HH-MM-SS`. 2-значный год → плохо сортируется лексически, поплывёт на 2100. `YYYY-MM-DD_HH-MM-SS` (как делает `Get-Date -Format 'yyyyMMdd-HHmmss'` в PS-скриптах) был бы консистентнее.
- **`exportDiagnostics`** хардкодит `version: '0.9.0'` (см. P1).
- **Inline `style.cssText` в DOM-build функциях** ([updSide](https://claude.ai/epitaxy/src/app.js:2731), сотни строк) — медленно, плохо темизируется, мешает CSP. Часть стилей можно вытащить в `styles.css` с классами вроде `.pi-tag-label`, `.pi-comment-row`, `.pi-click-pad` и т.п.
- **`renderMarkerAddSelect`** ([app.js:3850](https://claude.ai/epitaxy/src/app.js:3850)) проверяет `if(sel.options.length) return;` — хорошо для idempotency, но если маркер-конфигурация когда-то станет динамической, кеш не обновится.

---

## 4. Тесты, сборка, CI

|Аспект|Статус|
|---|---|
|Локальная сборка `npm run build`|✅ ок (`Built …/dist/server`)|
|`npm test`|✅ 19/19 pass за ~99 мс|
|Покрытие парсера (wide/grouped/EN-headers/epoch/CP1251/UTF-16)|✅ есть|
|Покрытие worker'ов (parses sample, downsample)|✅ есть|
|Build-manifest gate (SHA-256 source ↔ server)|✅ есть|
|GitHub Actions (`web-ci.yml`)|✅ запускает `npm test` на Node 22|
|Регрессия для drift app.js ↔ parser.worker.js|❌ см. **P0**|
|Performance budgets / smoke на large logs|❌ нет|
|E2E (Playwright/Puppeteer) для UI|❌ нет|
|Browser support matrix|Не задокументирована|

---

## 5. Безопасность и приватность

- ✅ Никаких сетевых запросов из приложения.
- ✅ Path-traversal в PS-сервере покрыт.
- ✅ Импорт сессий/маркеров — лимиты + sanitization.
- ✅ HTML-инъекции в Plotly-аннотациях — `escapeHtml`.
- ✅ Bidi/control-zachistka на входе.
- ⚠ CSP в локальном сервере отсутствует (см. P2).
- ⚠ `'unsafe-inline'` нужен из-за inline event handlers и стилей (см. P1).
- ⚠ Single-thread сервер — DoS-риск только в LAN-сценарии.

---

## 6. Производительность

Архитектурные пределы хороши для small/medium:

- `MAX_PTS = 5000` отображаемых точек на ряд;
- `WEBGL_THRESHOLD = 2000` — переход на `scattergl`;
- LRU-кеш и Plotly.react fast-path;
- Workers для парсинга и precompute.

Лимиты для large:

- `MAX_INPUT_FILE_BYTES = 250 МБ` — оптимистичный, реальный peak ~3-4× от размера файла;
- `MAX_SESSION_POINTS = 12 млн` — упрётся в JSON serialization до того, как в Plotly;
- Bounded concurrency 1–2 — хорошо;
- Streaming-parser отсутствует — рефакторинг на ~2 недели работы, но снимет потолок.

---

## 7. Документация

- ✅ `README.md`, `RUNBOOK.md`, `CHANGELOG.md`, `RELEASE_NOTES.md`, `SECURITY_HEADERS.md` — каждый на en + ru.
- ✅ `RUNBOOK.md` содержит release-чек-лист.
- ⚠ Нет ARCHITECTURE.md / диаграммы потока данных. Текущая структура (template → build → server, с workers по сторонам) очевидна, но 5808 строк app.js + 232+165 строк worker'ов + 77 строк build выиграли бы от схемы.
- ⚠ В `RUNBOOK.md` упомянут `Сессия → Диагностика JSON`, но нет описания, что делать с этим JSON (куда отправлять, как анализировать).

---

## 8. Приоритизированный список действий

|Приоритет|Действие|Файлы|Усилие|
|---|---|---|---|
|**P0**|Тест на синхронность parse-функций app.js ↔ parser.worker.js (хеш или AST diff)|`tools/build.mjs`, `tests/`|2–3 ч|
|**P0**|То же для app.js ↔ trace.worker.js|как выше|1 ч|
|**P1**|Удалить мёртвую строку [app.js:4178](https://claude.ai/epitaxy/src/app.js:4178)|1 строка|5 мин|
|**P1**|Один источник истины для версии (`const VERSION = '0.9.1'` в app.js, подставлять в template build'ом)|`tools/build.mjs`, `app.js`, `index.template.html`|30 мин|
|**P1**|Заменить ключевые `setTimeout(…, N)` на `await Plotly.relayout(…)`|`src/app.js` зум/сессии|2–4 ч|
|**P2**|Helper `downloadBlob(blob, filename)`, привести экспорты к одному виду (`appendChild`+`remove`)|5–6 мест в app.js|30 мин|
|**P2**|Добавить CSP в `serve-local.ps1` (взять из `SECURITY_HEADERS.md`)|`serve-local.ps1:51`|10 мин|
|**P2**|Разнести крупные `style.cssText` в CSS-классы|`app.js` updSide и др.|4–6 ч|
|**P2**|2–3 дополнительных sample-файла (grouped, CP1251, UTF-16) под `data_base/`|`data_base/`|1 ч|
|**P3**|`fileTS()` → `YYYY-MM-DD_HH-MM-SS`|`app.js:2503`|5 мин|
|**P3**|Разбить `app.js` на тематические части и склеивать в build|`src/parts/*`, `tools/build.mjs`|1–2 дня|

---

## 9. Финальный вердикт

**Production-ready для заявленного use-case** (один оператор смотрит SCADA-логи на своей машине, файл до ~50 МБ): код сильнее среднего для подобных тулз, безопасностные основы заложены, тестов достаточно, чтобы регрессии ловились в CI. Главный исторический P0 закрыт.

Перед следующим релизом разумно закрыть **P0** (drift-detection между app.js и worker'ами) и расчистить мелочи (P1 пункты 3.3-3.5) — они недорого, но повышают доверие к артефакту.