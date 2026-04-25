import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(repoRoot, 'src');
const distDir = join(repoRoot, 'dist');
const serverDir = join(distDir, 'server');
const singleDir = join(distDir, 'single-file');

const templatePath = join(srcDir, 'index.template.html');
const stylesPath = join(srcDir, 'styles.css');
const appPath = join(srcDir, 'app.js');
const vendorPath = join(repoRoot, 'vendor', 'plotly-3.5.0.min.js');
const parserWorkerPath = join(repoRoot, 'parser.worker.js');
const traceWorkerPath = join(repoRoot, 'trace.worker.js');

for (const path of [templatePath, stylesPath, appPath, vendorPath, parserWorkerPath, traceWorkerPath]) {
  if (!existsSync(path)) throw new Error(`Missing required build input: ${path}`);
}

function cleanDir(path) {
  mkdirSync(path, { recursive: true });
  for (const entry of readdirSync(path)) {
    rmSync(join(path, entry), { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function inlineStandalone({ template, styles, app, plotly }) {
  return template
    .replace('<link rel="stylesheet" href="styles.css" />', `<style>\n${styles}\n</style>`)
    .replace('<script src="vendor/plotly-3.5.0.min.js"></script>', `<script>\n${plotly}\n</script>`)
    .replace('<script src="app.js"></script>', `<script>\n${app}\n</script>`);
}

function sha256(textOrBuffer) {
  return createHash('sha256').update(textOrBuffer).digest('hex');
}

cleanDir(serverDir);
cleanDir(singleDir);

const template = readFileSync(templatePath, 'utf8');
const styles = readFileSync(stylesPath, 'utf8');
const app = readFileSync(appPath, 'utf8');
const plotly = readFileSync(vendorPath, 'utf8');

writeFileSync(join(serverDir, 'log-graph-v091.html'), template);
writeFileSync(join(serverDir, 'styles.css'), styles);
writeFileSync(join(serverDir, 'app.js'), app);
copyFileSync(parserWorkerPath, join(serverDir, 'parser.worker.js'));
copyFileSync(traceWorkerPath, join(serverDir, 'trace.worker.js'));
ensureDir(join(serverDir, 'vendor'));
copyFileSync(vendorPath, join(serverDir, 'vendor', 'plotly-3.5.0.min.js'));

const parserWorker = readFileSync(parserWorkerPath);
const traceWorker = readFileSync(traceWorkerPath);
const plotlyBuffer = readFileSync(vendorPath);
const manifest = {
  entrypoint: 'log-graph-v091.html',
  mode: 'static-server',
  sources: {
    'src/index.template.html': sha256(template),
    'src/styles.css': sha256(styles),
    'src/app.js': sha256(app),
    'parser.worker.js': sha256(parserWorker),
    'trace.worker.js': sha256(traceWorker),
    'vendor/plotly-3.5.0.min.js': sha256(plotlyBuffer)
  }
};
writeFileSync(join(serverDir, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const standalone = inlineStandalone({ template, styles, app, plotly });
writeFileSync(join(singleDir, 'log-graph-v091-standalone.html'), standalone);

// Keep the historical root filename as the emergency standalone artifact.
writeFileSync(join(repoRoot, 'log-graph-v091.html'), standalone);

// Runtime docs are useful in both dist variants.
for (const doc of [
  'README.ru.md',
  'RUNBOOK.ru.md',
  'RELEASE_NOTES.ru.md',
  'CHANGELOG.ru.md',
  'SECURITY_HEADERS.ru.md',
  'README.md',
  'RUNBOOK.md',
  'RELEASE_NOTES.md',
  'CHANGELOG.md',
  'SECURITY_HEADERS.md'
]) {
  const src = join(repoRoot, doc);
  if (existsSync(src)) copyFileSync(src, join(serverDir, doc));
}

cpSync(serverDir, join(singleDir, 'server-runtime'), { recursive: true });

console.log(`Built ${serverDir}`);
console.log(`Built ${join(singleDir, 'log-graph-v091-standalone.html')}`);
console.log('Updated root log-graph-v091.html as standalone emergency build');
