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

Открыть `http://localhost:8080/index.html`.

## Перенос на другой ПК

Минимальный runtime-комплект:

```text
dist/server/
index.html
styles.css
app.js
parser-core.js
parser.worker.js
trace.worker.js
build-manifest.json
vendor/plotly-3.5.0.min.js
```

Рекомендуемый комплект для zip-переноса:

```text
index.html
styles.css
app.js
parser-core.js
parser.worker.js
trace.worker.js
build-manifest.json
serve-local.ps1
vendor/plotly-3.5.0.min.js
docs/
```

Portable zip не является отдельной сборкой и не содержит другой runtime. Это обычный `dist/server`, упакованный вместе с `serve-local.ps1`, чтобы на объекте не вспоминать состав файлов. Не класть в архив реальные технологические логи, если их не нужно передавать явно. Сессии лучше переносить отдельными `.pagraph.json.gz` через меню приложения.

## Windows-развёртывание в командировке

1. Распаковать portable zip в любую локальную папку, например `D:\tools\pa-graph`.
2. Запустить:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve-local.ps1
```

3. Откроется `http://127.0.0.1:8765/index.html`.
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

Открыть `http://127.0.0.1:8765/index.html`.

Вариант 2, если установлен PowerShell Core (`pwsh`):

```bash
pwsh ./serve-local.ps1
```

Если на объекте нельзя запускать локальный сервер, этот проект в штатном виде использовать нельзя: workers и статическая модель поставки требуют HTTP-origin. Для таких объектов лучше заранее согласовать запуск `serve-local.ps1` или штатный внутренний HTTP-сервер.

## Проверка

```bash
npm test
```

Ожидаемый результат: все тесты проходят.

## Передача на ревью

Для code/architecture review собирать отдельный source bundle:

```powershell
npm run review:bundle
```

Отправлять `dist/log-graph-review-source-*.zip`. Не отправлять отдельный `log-graph-v091.html` из старых сборок: текущий entrypoint генерируется как `dist/server/index.html` и должен проверяться через `npm run build`.

`dist/server/build-manifest.json` должен совпадать по SHA-256 с текущими исходниками и `package.json`; версия в UI подставляется именно из `package.json`.

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
3. Загрузить `data_base/test_base.txt` из чистого checkout или реальный объектовый лог при локальной приёмке.
4. Проверить, что первые три параметра отображаются.
5. Экспортировать `CSV сырой long` и убедиться, что `°C`, epoch µs, источник времени и merge-conflict колонка сохранены.
6. Сохранить сессию в браузере и экспортировать файл сессии.
7. Перезагрузить страницу и импортировать файл сессии.
8. Проверить `dist/server/build-manifest.json`: SHA-256 для исходников и `package.json` должны совпадать с текущим checkout.
