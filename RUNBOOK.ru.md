# Runbook

## Локальный запуск

Сначала собрать runtime:

```bash
npm run build
```

Штатный режим — раздать `dist/server` как статический сайт:

```bash
cd dist/server
python -m http.server 8080
```

Открыть `http://localhost:8080/log-graph-v091.html`.

## Перенос на другой ПК

Минимальный runtime-комплект:

```text
dist/server/
log-graph-v091.html
styles.css
app.js
parser.worker.js
trace.worker.js
vendor/plotly-3.5.0.min.js
```

Рекомендуемый portable-комплект:

```text
log-graph-v091.html
parser.worker.js
trace.worker.js
serve-local.ps1
vendor/plotly-3.5.0.min.js
README.ru.md
RUNBOOK.ru.md
RELEASE_NOTES.ru.md
CHANGELOG.ru.md
SECURITY_HEADERS.ru.md
```

Не класть в portable-архив реальные технологические логи, если их не нужно передавать явно. Сессии лучше переносить отдельными `.pagraph.json.gz` через меню приложения.

## Windows-развёртывание в командировке

1. Распаковать portable zip в любую локальную папку, например `D:\tools\pa-graph`.
2. Запустить:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve-local.ps1
```

3. Откроется `http://127.0.0.1:8765/log-graph-v091.html`.
4. Если браузер не открылся автоматически, открыть URL вручную.
5. Остановить сервер через `Ctrl+C` в окне PowerShell.

Если порт занят:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve-local.ps1 -Port 8080
```

## Linux-развёртывание

Вариант 1, если есть Python:

```bash
python3 -m http.server 8765
```

Открыть `http://127.0.0.1:8765/log-graph-v091.html`.

Вариант 2, если установлен PowerShell Core (`pwsh`):

```bash
pwsh ./serve-local.ps1
```

Если на объекте нельзя запускать локальный сервер, нужен заранее собранный standalone HTML через `make-portable.ps1 -IncludeStandalone`. Это fallback-режим: приложение должно работать, но внешний `trace.worker.js` не будет использоваться, а поведение blob-worker зависит от политики браузера.

## Проверка

```bash
npm test
```

Ожидаемый результат: все тесты проходят.

## Хранилище браузера

Сессии сохраняются в IndexedDB только после команды сохранения/импорта. Пресеты и маркеры используют localStorage. Чтобы очистить всё локальное состояние:

1. Открыть DevTools браузера.
2. Перейти в Application / Storage.
3. Выполнить Clear site data для origin.

При сохранении сессии приложение запрашивает persistent storage. Браузер может отказать по собственной политике.

## Восстановление сессий

Использовать `Сессия -> Экспорт в файл`, чтобы архивировать переносимый `.pagraph.json.gz`. Если storage браузера очищен или повреждён, импортировать этот файл через `Сессия -> Импорт из файла`.

Если импорт сессии не проходит validation:

- проверить размер файла;
- убедиться, что JSON содержит массив `ap`;
- проверить, что массивы `x` и `y` содержат числовые значения;
- уменьшить oversized-сессию, если она превышает лимиты проекта.

## Диагностика

Использовать `Сессия -> Диагностика JSON`, чтобы выгрузить локальный диагностический отчёт. Он содержит:

- имена загруженных файлов;
- количество параметров и точек;
- количество bad-quality точек;
- последние performance samples;
- локально пойманные runtime errors;
- оценку browser storage, если API поддерживается.

Диагностика никуда не отправляется по сети.

## Release Checklist

1. Запустить `npm test`.
2. Открыть приложение через локальный статический сервер.
3. Загрузить `data_base/22-02-2026_12-00_OPRCH_v4_.txt`.
4. Проверить, что первые три параметра отображаются.
5. Экспортировать `CSV сырой long` и убедиться, что `°C` и epoch µs сохранены.
6. Сохранить сессию в браузере и экспортировать файл сессии.
7. Перезагрузить страницу и импортировать файл сессии.
