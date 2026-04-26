# Security Headers

Эти заголовки стоит использовать при раздаче проекта по HTTP(S). Приложение рассчитано на локальную/offline-работу и не требует внешней сети.

## Пример для Nginx

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
add_header Cross-Origin-Resource-Policy "same-origin" always;

# build загружает Plotly/app/styles из локальных файлов. JS event wiring вынесен во внешний app.js;
# style-src пока разрешает inline styles, потому что Plotly и текущая вёрстка используют style-атрибуты.
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" always;
```

## Примечания

- `build` является единственным штатным runtime.
- `serve-local.ps1` отдаёт тот же CSP для локального запуска.
- `worker-src 'self'` нужен для `parser.worker.js` и `trace.worker.js`.
- `img-src blob: data:` нужен для PNG-экспорта и Plotly image generation.
- `connect-src 'none'` фиксирует ожидаемую no-network модель.
- Чтобы убрать style `'unsafe-inline'`, нужно перевести template style-атрибуты в CSS-классы и отдельно проверить Plotly под такой политикой.
