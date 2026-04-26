# PA-GRAPH / log-graph

Офлайн-графопостроитель для SCADA/PLC логов. Штатный запуск — статическая раздача `dist/server`.

## Быстрый Запуск

```powershell
npm run build
powershell -ExecutionPolicy Bypass -File .\serve-local.ps1
```

Откроется `http://127.0.0.1:8765/index.html`.

## Структура

```text
src/                 исходный HTML-шаблон, CSS, app JS и workers
src/parser-core.js   чистое ядро декодирования и парсинга
src/parser.worker.js worker парсинга логов
src/trace.worker.js  worker подготовки рядов
vendor/              локальные browser-зависимости для офлайна
tools/               build-инструменты
tests/               Node regression-тесты
docs/                документация
review/              внешние ревью проекта
dist/server/         генерируемый статический runtime
```

`dist/` не хранится в Git. Single-file HTML больше не собирается: один штатный runtime проще проверять и сопровождать.
Версия runtime берётся из `package.json` при `npm run build`.

## Большие Логи

- Штатный импорт рассчитан на запуск через HTTP и потоковый `parser.worker.js`.
- Лимит входного файла поднят до 8 GiB, но практический предел зависит от RAM, числа тегов и браузера.
- Полный raw text хранится только для файлов до 25 MiB. Для больших логов парсер строит ряды, но сохранение исходного файла с переименованными тегами отключается.
- Для тяжелых графиков доступен режим прореживания `MinMaxLTTB`: он сначала сохраняет локальные экстремумы, затем применяет LTTB.

## Документация

- [README.ru.md](docs/README.ru.md)
- [RUNBOOK.ru.md](docs/RUNBOOK.ru.md)
- [CHANGELOG.ru.md](docs/CHANGELOG.ru.md)
- [RELEASE_NOTES.ru.md](docs/RELEASE_NOTES.ru.md)
- [REVIEW_READINESS.ru.md](docs/REVIEW_READINESS.ru.md)
- [SECURITY_HEADERS.ru.md](docs/SECURITY_HEADERS.ru.md)

## Проверка

```powershell
npm test
```

## Bundle Для Ревью

```powershell
npm run review:bundle
```

Архив `dist/log-graph-review-source-*.zip` содержит исходники, тесты, документацию, `vendor/`, `.github/` и маленький sample. Он намеренно не содержит `dist/`, `.git/`, generated HTML и production-логи.
