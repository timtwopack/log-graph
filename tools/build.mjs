import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(repoRoot, 'src');
const docsDir = join(repoRoot, 'docs');
const buildDir = join(repoRoot, 'build');
const distDir = join(repoRoot, 'dist');
const legacyServerDir = join(distDir, 'server');
const legacySingleDir = join(distDir, 'single-file');
const legacyRootHtml = join(repoRoot, 'log-graph-v091.html');

const templatePath = join(srcDir, 'index.template.html');
const stylesPath = join(srcDir, 'styles.css');
const appPath = join(srcDir, 'app.js');
const vendorPath = join(repoRoot, 'vendor', 'plotly-3.5.0.min.js');
const parserCorePath = join(srcDir, 'parser-core.js');
const parserWorkerPath = join(srcDir, 'parser.worker.js');
const traceWorkerPath = join(srcDir, 'trace.worker.js');
const packagePath = join(repoRoot, 'package.json');
const serveLocalPath = join(repoRoot, 'serve-local.ps1');

for (const path of [templatePath, stylesPath, appPath, vendorPath, parserCorePath, parserWorkerPath, traceWorkerPath, packagePath, serveLocalPath]) {
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

cleanDir(buildDir);
rmSync(legacyServerDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
rmSync(legacySingleDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
rmSync(legacyRootHtml, { force: true, maxRetries: 5, retryDelay: 150 });

const template = readFileSync(templatePath, 'utf8');
const styles = readFileSync(stylesPath, 'utf8');
const app = readFileSync(appPath, 'utf8');
const packageText = readFileSync(packagePath, 'utf8');
const serveLocal = readFileSync(serveLocalPath);
const packageJson = JSON.parse(packageText);
const appVersion = String(packageJson.version || '0.0.0');
const builtTemplate = template.replaceAll('__APP_VERSION__', appVersion);
const builtApp = app.replaceAll('__APP_VERSION__', appVersion);

writeFileSync(join(buildDir, 'index.html'), builtTemplate);
writeFileSync(join(buildDir, 'styles.css'), styles);
writeFileSync(join(buildDir, 'app.js'), builtApp);
copyFileSync(parserCorePath, join(buildDir, 'parser-core.js'));
copyFileSync(parserWorkerPath, join(buildDir, 'parser.worker.js'));
copyFileSync(traceWorkerPath, join(buildDir, 'trace.worker.js'));
copyFileSync(serveLocalPath, join(buildDir, 'serve-local.ps1'));
ensureDir(join(buildDir, 'vendor'));
copyFileSync(vendorPath, join(buildDir, 'vendor', 'plotly-3.5.0.min.js'));

const parserCore = readFileSync(parserCorePath);
const parserWorker = readFileSync(parserWorkerPath);
const traceWorker = readFileSync(traceWorkerPath);
const plotlyBuffer = readFileSync(vendorPath);
const manifest = {
  entrypoint: 'index.html',
  mode: 'static-server',
  sources: {
    'src/index.template.html': sha256(template),
    'src/styles.css': sha256(styles),
    'src/app.js': sha256(app),
    'package.json': sha256(packageText),
    'serve-local.ps1': sha256(serveLocal),
    'src/parser-core.js': sha256(parserCore),
    'src/parser.worker.js': sha256(parserWorker),
    'src/trace.worker.js': sha256(traceWorker),
    'vendor/plotly-3.5.0.min.js': sha256(plotlyBuffer)
  }
};
writeFileSync(join(buildDir, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

if (existsSync(docsDir)) {
  cpSync(docsDir, join(buildDir, 'docs'), { recursive: true });
}

console.log(`Built ${buildDir}`);
