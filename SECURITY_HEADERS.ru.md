# Security Headers

Эти заголовки стоит использовать при раздаче проекта по HTTP(S). Приложение рассчитано на локальную/offline-работу и не требует внешней сети.

## Пример для Nginx

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Resource-Policy "same-origin" always;

# dist/server загружает Plotly/app/styles из локальных файлов, но HTML пока содержит inline handlers/styles.
# CSP без unsafe-inline требует отдельного UI-refactor шага: убрать inline onclick/style из шаблона.
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" always;
```

## Примечания

- `dist/server` является штатным режимом; `log-graph-v091.html` в корне и `dist/single-file` — generated standalone fallback.
- `worker-src 'self' blob:` нужен для `parser.worker.js`, `trace.worker.js` и fallback-workers.
- `img-src blob: data:` нужен для PNG-экспорта и Plotly image generation.
- `connect-src 'none'` фиксирует ожидаемую no-network модель.
- Чтобы убрать `'unsafe-inline'`, нужно перевести template на `addEventListener`/CSS-классы вместо inline `onclick`/`style`.
