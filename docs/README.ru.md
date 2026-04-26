# PA-GRAPH / log-graph

Офлайн-инструмент в браузере для загрузки локальных SCADA/PLC-логов, построения временных рядов, измерений по диапазонам, экспорта CSV/PNG и сохранения переносимых сессий.

## Запуск

Проект теперь разделён на исходники и сборку:

```text
src/                      исходный HTML-шаблон, CSS, app JS и workers
src/parser-core.js        чистое ядро декодирования и парсинга
src/parser.worker.js      worker парсера
src/trace.worker.js       worker подготовки рядов
vendor/                   локальный Plotly для офлайна
tools/                    build-инструменты
tests/                    regression-тесты
docs/                     документация
review/                   внешние ревью проекта
dist/server/              генерируемый статический runtime
```

Собрать артефакты:

```bash
npm run build
```

Штатный режим — раздать `dist/server` как статический сайт:

```bash
cd dist/server
python -m http.server 8080
```

Затем открыть `http://localhost:8080/index.html`.

Статическая раздача обязательна для предсказуемой работы workers (`parser.worker.js`, `trace.worker.js`). Прямое открытие HTML больше не является поддерживаемым режимом: оно ломает модель workers и создаёт лишний релизный артефакт.

Единственный source-of-truth для runtime — `src/index.template.html`, `src/styles.css`, `src/app.js`, `src/parser-core.js`, worker-файлы в `src/` и `package.json` с версией. `dist/server` пересобирается командой `npm run build`; руками его не править. В `dist/server/build-manifest.json` записываются SHA-256 исходников, а `npm test` проверяет, что server-HTML подключает внешний `app.js`.

## Большие логи

Основной сценарий проекта — локальное открытие технологических логов через статический сервер. Для файлов в несколько ГБ приложение не читает весь файл в main thread: браузер передаёт `File` в `parser.worker.js`, worker читает его потоком через `File.stream()` и декодирует обычным `TextDecoder` в streaming-режиме.

Текущие ограничения:

- входной файл принимается до 8 GiB;
- несколько файлов парсятся не более чем в 1-2 параллельные задачи;
- полный raw text хранится в памяти только для файлов до 25 MiB;
- для больших файлов сохраняются распарсенные ряды, `status`, `epochUs`, источник времени и диагностические признаки, но команда сохранения исходного файла с переименованными тегами отключается;
- если браузер не поддерживает `File.stream()`/workers, штатный импорт больших файлов невозможен.

Для отрисовки длинных рядов оставлены несколько режимов прореживания. `LTTB` остаётся хорошим визуальным режимом по умолчанию, `Мин-Макс` сохраняет экстремумы, а `MinMaxLTTB` сначала предвыбирает локальные минимумы/максимумы и затем применяет LTTB. На больших аварийных логах этот режим часто полезен, когда нельзя потерять короткие пики.

### `Plotly.react` и `newPlot`

В коде есть оба вызова намеренно. `Plotly.react` используется как быстрый путь, когда структура графика уже создана и меняются данные, диапазоны, цвета, маркеры или настройки отображения. `Plotly.newPlot` нужен для первого построения и для редких случаев, когда меняется DOM-структура графиков: режим overlay/single/XY, число панелей, rangeslider, тема или набор параметров. Убирать `newPlot` полностью невыгодно: тогда часть структурных переключений пришлось бы поддерживать более хрупким ручным кодом.

### Минимальный переносимый комплект

Для работы графопостроителя на другом ПК нужны только runtime-файлы:

```text
dist/server/
index.html
styles.css
app.js
parser-core.js
parser.worker.js
trace.worker.js
build-manifest.json
vendor/
  plotly-3.5.0.min.js
```

Для удобного переносимого запуска рекомендуется добавить:

```text
serve-local.ps1
docs/
```

Папки `tests/`, `.github/`, `data_base/` и файл `package.json` не нужны для работы у конечного пользователя. Они нужны для разработки, CI и проверки.

### Windows-запуск без Python/npm

В папке проекта:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve-local.ps1
```

В dev-папке скрипт автоматически отдаёт `dist/server`. В portable-папке он отдаёт текущую папку. Скрипт поднимает локальный сервер на `127.0.0.1:8765` и открывает приложение. Порт можно изменить:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve-local.ps1 -Port 8080
```

### Сборка portable zip

```powershell
powershell -ExecutionPolicy Bypass -File .\make-portable.ps1
```

Архив появится в `dist/pa-graph-portable-*.zip`. Это не отдельная версия приложения, а zip-упаковка того же `dist/server` плюс `serve-local.ps1` для переноса на другой ПК. По умолчанию production-логи и sample-файлы не включаются. Если нужен маленький тестовый sample:

```powershell
powershell -ExecutionPolicy Bypass -File .\make-portable.ps1 -IncludeSamples
```

### Сборка архива для ревью

```powershell
npm run review:bundle
```

Архив появится в `dist/log-graph-review-source-*.zip`. Его нужно отправлять на code/architecture review: в нём есть source, docs, tests, CI, vendor и маленький sample. В нём намеренно нет `dist/`, `.git/`, generated HTML и production-логов, чтобы ревью не анализировало старый standalone вместо исходников.

## Тесты

```bash
npm test
```

Тесты проверяют критичное поведение:

- парсинг wide-лога на приложенном sample;
- сохранение `status` в grouped-формате;
- декодирование Windows-1251;
- декодирование UTF-16LE/UTF-16BE;
- приоритет epoch-времени над wall-clock колонками, если epoch есть;
- ограничение параллельного чтения файлов до 1-2 задач, чтобы не взрывать память на больших логах;
- маркировку merge-конфликтов по одинаковым `tag + timestamp`;
- точечную замену только нужных ячеек header при сохранении переименованных тегов;
- целостность server-runtime артефакта после сборки;
- escaping CSV;
- отсутствие интерполяции в raw-long CSV;
- синтаксис и базовую работу workers.

## Работа с данными

Приложение работает локально и не обращается к внешним сервисам. Полные сессии записываются в IndexedDB только после явной команды сохранения или импорта. CSV по умолчанию экспортируется как UTF-8 с BOM; для старых Excel-сценариев оставлен legacy-экспорт CP1251.

## Эксплуатация

- `docs/RUNBOOK.ru.md` — запуск, восстановление, диагностика и release-checklist.
- `docs/SECURITY_HEADERS.ru.md` — шаблон заголовков для статического хостинга.
- `docs/CHANGELOG.ru.md` — список изменений после ревью.
- `docs/RELEASE_NOTES.ru.md` — краткое описание hardened-сборки.
- `docs/REVIEW_READINESS.ru.md` — памятка для следующего полного ревью.
