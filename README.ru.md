# PA-GRAPH / log-graph-v091

Офлайн-инструмент в браузере для загрузки локальных SCADA/PLC-логов, построения временных рядов, измерений по диапазонам, экспорта CSV/PNG и сохранения переносимых сессий.

## Запуск

Проект теперь разделён на исходники и сборку:

```text
src/                      исходный HTML-шаблон, CSS и app JS
parser.worker.js          worker парсера
trace.worker.js           worker подготовки рядов
dist/server/              основной portable runtime для локального сервера
dist/single-file/         опциональный аварийный standalone HTML
log-graph-v091.html       root-копия standalone HTML, не штатный режим
```

Собрать артефакты:

```bash
npm run build
```

Штатный режим — раздать `dist/server` как статический сайт:

```bash
python -m http.server 8080
```

Затем открыть `http://localhost:8080/log-graph-v091.html`.

Статическая раздача обязательна для предсказуемой работы workers (`parser.worker.js`, `trace.worker.js`). Прямое открытие standalone HTML остаётся только аварийным вариантом, когда запуск локального сервера запрещён политикой объекта.

### Минимальный переносимый комплект

Для работы графопостроителя на другом ПК нужны только runtime-файлы:

```text
dist/server/
log-graph-v091.html
styles.css
app.js
parser.worker.js
trace.worker.js
vendor/
  plotly-3.5.0.min.js
```

Для удобного переносимого запуска рекомендуется добавить:

```text
serve-local.ps1
README.ru.md
RUNBOOK.ru.md
RELEASE_NOTES.ru.md
CHANGELOG.ru.md
SECURITY_HEADERS.ru.md
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

Архив появится в `dist/pa-graph-portable-*.zip`. По умолчанию production-логи, sample-файлы и standalone HTML не включаются. Если нужен маленький тестовый sample:

```powershell
powershell -ExecutionPolicy Bypass -File .\make-portable.ps1 -IncludeSamples
```

Если нужен аварийный HTML для двойного клика:

```powershell
powershell -ExecutionPolicy Bypass -File .\make-portable.ps1 -IncludeStandalone
```

## Тесты

```bash
npm test
```

Тесты проверяют критичное поведение:

- парсинг wide-лога на приложенном sample;
- сохранение `status` в grouped-формате;
- декодирование Windows-1251;
- escaping CSV;
- отсутствие интерполяции в raw-long CSV;
- синтаксис и базовую работу workers.

## Работа с данными

Приложение работает локально и не обращается к внешним сервисам. Полные сессии записываются в IndexedDB только после явной команды сохранения или импорта. CSV по умолчанию экспортируется как UTF-8 с BOM; для старых Excel-сценариев оставлен legacy-экспорт CP1251.

## Эксплуатация

- `RUNBOOK.ru.md` — запуск, восстановление, диагностика и release-checklist.
- `SECURITY_HEADERS.ru.md` — шаблон заголовков для статического хостинга.
- `CHANGELOG.ru.md` — список изменений после ревью.
- `RELEASE_NOTES.ru.md` — краткое описание hardened-сборки.
