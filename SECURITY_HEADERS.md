# Security Headers

Use these headers when serving the project over HTTP(S). The app is intentionally local/offline and does not need external network access.

## Nginx Example

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Resource-Policy "same-origin" always;

# Plotly is currently loaded from local vendor/ and the app has inline script/style.
# A strict no-inline CSP requires a build step with externalized scripts/styles.
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" always;
```

## Notes

- `worker-src 'self' blob:` is required for `parser.worker.js`, `trace.worker.js`, and direct-file fallback workers.
- `img-src blob: data:` is required for PNG export and Plotly image generation.
- `connect-src 'none'` documents the intended no-network posture.
- Removing `'unsafe-inline'` requires moving the inline script and style blocks out of `log-graph-v091.html`.
