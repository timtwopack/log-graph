# Журнал изменений

## 0.9.1-review-hardening

- Добавлена загрузка файлов с определением кодировки: UTF-8, Windows-1251, UTF-16LE и UTF-16BE.
- Декодирование и парсинг вынесены в `parser.worker.js` для запуска через статический сервер; для прямого открытия HTML оставлен inline blob fallback.
- Добавлен `trace.worker.js` для предварительного фонового downsampling/cache warmup.
- Значения `status` из grouped-формата сохраняются по каждой точке.
- Опциональная epoch-метка сохраняется как `epochUs`, при этом UI остаётся на локальном времени из колонок `Дата/Время/мс`.
- Добавлен `signalKind` (`analog`, `binary`, `step`, `setpoint`) и ручной выбор типа сигнала в сайдбаре.
- Добавлен фильтр качества для исключения non-good status точек из графиков, статистики, сглаживания и поиска аномалий.
- Неоднозначный raw CSV заменён на `raw-long` экспорт без интерполяции.
- Выровненный/interpolated CSV вынесен в отдельный явный экспорт.
- CSV по умолчанию теперь UTF-8 с BOM; CP1251 оставлен только как legacy raw-export.
- Конверсия единиц сохраняет raw-значения/raw-unit для точного возврата и аудита.
- Импорт сессий и маркеров получил validation, size limits и нормализацию текста.
- Добавлен локальный экспорт диагностики с performance samples и runtime errors.
- Добавлены Node-тесты и GitHub Actions workflow.
- Введена структура `src/` + `dist/server` + `dist/single-file`.
- Добавлен `tools/build.mjs`, который собирает основной server-runtime и опциональный standalone HTML.
- Portable zip теперь по умолчанию содержит только штатный server-runtime; standalone включается только флагом `-IncludeStandalone`.
