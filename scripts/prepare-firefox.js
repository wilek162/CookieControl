/*
 Prepares a Firefox-ready build in dist/firefox by copying the project files
 and swapping manifest.firefox.json -> manifest.json.
*/

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.resolve(root, 'dist', 'firefox');
const srcManifest = path.join(root, 'manifest.firefox.json');
const destManifest = path.join(outDir, 'manifest.json');

const IGNORE_DIRS = new Set([
  '.git', '.github', '.windsurf', 'node_modules', 'dist', 'docs', 'tests', 'scripts'
]);
const IGNORE_FILES = new Set([
  // Keep LICENSE; skip common markdown docs in staging
  'README.md', 'CODE_SMELLS.md', 'REFACTOR_PLAN.md', 'REFERENCES.md',
  // Skip dev/control files in staging
  'package.json', 'package-lock.json', '.gitignore', '.web-extignore', '.web-ext-ignore',
  // Skip overlay manifest itself; we will merge separately
  'manifest.firefox.json'
]);

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function deepMerge(base, overlay) {
  if (Array.isArray(base) && Array.isArray(overlay)) return overlay.slice();
  if (typeof base !== 'object' || base === null) return overlay;
  const out = { ...base };
  for (const [k, v] of Object.entries(overlay || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    const name = path.basename(src);
    if (IGNORE_DIRS.has(name)) return;
    // Skip deprecated permissions prompt directory specifically
    const rel = path.relative(root, src).replace(/\\/g, '/');
    if (rel === 'src/permissions') return;
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    // Skip the Chromium manifest; Firefox will use its own
    if (path.basename(src) === 'manifest.json') return;
    const base = path.basename(src);
    // Keep .web-extignore, skip markdown files and explicitly ignored files
    if (IGNORE_FILES.has(base)) return;
    if (base !== 'manifest.json' && /^manifest\..+\.json$/.test(base)) return;
    if (base.endsWith('.md') && base !== '.web-extignore') return;
    fs.copyFileSync(src, dest);
  }
}

(function main() {
  ensureDir(outDir);
  // Clean outDir to avoid stale files
  for (const entry of fs.readdirSync(outDir)) {
    const p = path.join(outDir, entry);
    fs.rmSync(p, { recursive: true, force: true });
  }
  // Copy all files except the Chromium manifest and ignored items
  copyRecursive(root, outDir);

  // Merge base manifest with Firefox overlay
  const basePath = path.join(root, 'manifest.json');
  if (!fs.existsSync(basePath)) {
    console.error('Base manifest.json not found');
    process.exit(1);
  }
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  let result = base;
  if (fs.existsSync(srcManifest)) {
    const overlay = JSON.parse(fs.readFileSync(srcManifest, 'utf8'));
    result = deepMerge(base, overlay);
  }
  fs.writeFileSync(destManifest, JSON.stringify(result, null, 2));

  console.log('Firefox build prepared at', outDir);
})();
