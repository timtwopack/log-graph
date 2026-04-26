import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(repoRoot, 'src');
const docsDir = join(repoRoot, 'docs');
const distDir = join(repoRoot, 'dist');
const serverDir = join(distDir, 'server');
const legacySingleDir = join(distDir, 'single-file');
const legacyRootHtml = join(repoRoot, 'log-graph-v091.html');

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

function sha256(textOrBuffer) {
  return createHash('sha256').update(textOrBuffer).digest('hex');
}

cleanDir(serverDir);
rmSync(legacySingleDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
rmSync(legacyRootHtml, { force: true, maxRetries: 5, retryDelay: 150 });

const template = readFileSync(templatePath, 'utf8');
const styles = readFileSync(stylesPath, 'utf8');
const app = readFileSync(appPath, 'utf8');

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

if (existsSync(docsDir)) {
  cpSync(docsDir, join(serverDir, 'docs'), { recursive: true });
}

console.log(`Built ${serverDir}`);
