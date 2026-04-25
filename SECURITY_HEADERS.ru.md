# Security Headers

Эти заголовки стоит использовать при раздаче проекта по HTTP(S). Приложение рассчитано на локальную/offline-работу и не требует внешней сети.

## Пример для Nginx

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Resource-Policy "same-origin" always;

# Plotly сейчас загружается из локальной vendor/ папки, а приложение всё ещё содержит inline script/style.
# CSP без inline требует отдельного build/refactor шага с выносом scripts/styles во внешние файлы.
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" always;
```

## Примечания

- `worker-src 'self' blob:` нужен для `parser.worker.js`, `trace.worker.js` и fallback-workers при прямом открытии файла.
- `img-src blob: data:` нужен для PNG-экспорта и Plotly image generation.
- `connect-src 'none'` фиксирует ожидаемую no-network модель.
- Чтобы убрать `'unsafe-inline'`, нужно вынести inline script/style из `log-graph-v091.html`.
