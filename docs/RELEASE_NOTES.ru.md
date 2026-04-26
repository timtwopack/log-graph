# Release Notes: Review Hardening Build

Эта сборка закрывает production-readiness замечания из ревью `log-graph`.

## Корректность данных

- Входные файлы больше не считаются UTF-8 по умолчанию.
- Определение кодировки смотрит первые 64 KiB, чтобы устойчивее выбирать UTF-8/CP1251/UTF-16.
- Скрытые bidi/control Unicode-символы удаляются из импортируемых тегов.
- `status` из grouped-формата сохраняется по точкам.
- Если в wide-логе есть epoch-колонка, она определяется по нескольким начальным строкам и используется как источник времени; wall-clock колонки остаются fallback.
- Epoch хранится как абсолютный UTC instant; отображение и CSV можно явно переключить между Local и UTC.
- Двузначные годы нормализуются по окну `00..69 => 2000..2069`, `70..99 => 1970..1999`.
- Merge-конфликты по одинаковым `tag + timestamp` не теряются: обе точки сохраняются и помечаются для диагностики/CSV.
- Raw CSV теперь является audit-style long table без интерполяции.
- Aligned/interpolated CSV отделён от raw-export.
- Unit conversion сохраняет raw-значения для точного rollback.

## Производительность

- Декодирование и парсинг файлов выполняются только в `parser.worker.js`; статическая раздача обязательна.
- Для браузеров с `File.stream()` большие файлы читаются потоком прямо в worker без полного `arrayBuffer()` на main thread.
- Лимит входного файла поднят до 8 GiB; полный исходный текст хранится только для файлов до 25 MiB.
- Результат парсинга уходит из worker колоночными typed arrays через transfer-list, без structured clone всего дерева point-objects.
- При запуске через cross-origin isolated server-runtime parser worker отдаёт `SharedArrayBuffer`-backed колонки, которые main и trace worker читают без копирования.
- Основное состояние приложения теперь хранит точки через `ColumnarData`, а не через массив объектов.
- `trace.worker.js` хранит worker-owned state по `dataId`; prepare-запросы передают только id/meta/view. Без `SharedArrayBuffer` остаётся fallback на cloned typed arrays через transfer-list с byte-guard.
- Render/export/XY/statistics/session snapshot/unit conversion работают с колонками напрямую и больше не строят временные point-object массивы в этих путях.
- Загрузка нескольких файлов ограничена 1-2 одновременными задачами, чтобы снизить пик памяти на больших логах.
- Первичный downsampling может предварительно считаться в `trace.worker.js` при запуске через HTTP.
- Добавлен режим прореживания `MinMaxLTTB`, полезный для длинных рядов с короткими пиками.
- Для уже отсортированных рядов пропускается лишняя сортировка точек.
- Последние timings загрузки, рендера и precompute доступны в diagnostics export.

## Эксплуатация

- Импорт сессий валидирует структуру и ограничивает размер payload.
- Импорт маркеров валидирует форму массива и ограничивает количество записей.
- Перед сохранением сессии запрашивается persistent storage браузера.
- Добавлены тесты и CI workflow.
- Добавлена проверка целостности server-runtime артефакта и `build-manifest.json` с SHA-256 исходников.
- `serve-local.ps1` отдаёт COOP/COEP/CORP заголовки для включения cross-origin isolation и `SharedArrayBuffer`.

## Совместимость

Прямое открытие HTML больше не является поддерживаемым режимом. Штатный режим — статическая раздача `build`.
