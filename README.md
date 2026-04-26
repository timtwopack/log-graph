# PA-GRAPH / log-graph

Офлайн-графопостроитель для SCADA/PLC логов. Штатный запуск — статическая раздача `dist/server`.

## Быстрый Запуск

```powershell
npm run build
powershell -ExecutionPolicy Bypass -File .\serve-local.ps1
```

Откроется `http://127.0.0.1:8765/log-graph-v091.html`.

## Структура

```text
src/                 исходный HTML-шаблон, CSS и app JS
parser.worker.js     worker парсинга логов
trace.worker.js      worker подготовки рядов
vendor/              локальные browser-зависимости для офлайна
tools/               build-инструменты
tests/               Node regression-тесты
docs/                документация
review/              внешние ревью проекта
dist/server/         генерируемый статический runtime
```

`dist/` не хранится в Git. Single-file HTML больше не собирается: один штатный runtime проще проверять и сопровождать.

## Документация

- [README.ru.md](docs/README.ru.md)
- [RUNBOOK.ru.md](docs/RUNBOOK.ru.md)
- [CHANGELOG.ru.md](docs/CHANGELOG.ru.md)
- [RELEASE_NOTES.ru.md](docs/RELEASE_NOTES.ru.md)
- [SECURITY_HEADERS.ru.md](docs/SECURITY_HEADERS.ru.md)

## Проверка

```powershell
npm test
```
