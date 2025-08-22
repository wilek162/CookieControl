/*
 Prepare a Chromium-ready build in dist/chromium by copying only necessary files
 and excluding dev artifacts. Intended to be zipped or built with web-ext.
*/

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const target = (process.argv[2] || 'chromium').toLowerCase();
const outDir = path.resolve(root, 'dist', target);

const IGNORE_DIRS = new Set([
  '.git', '.github', '.windsurf', 'node_modules', 'dist', 'docs', 'tests', 'scripts'
]);
const IGNORE_FILES = new Set([
  // Ship LICENSE, but skip typical markdown docs in the artifact
  'README.md', 'CODE_SMELLS.md', 'REFACTOR_PLAN.md', 'REFERENCES.md', 'manifest.firefox.json'
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
    const rel = path.relative(root, src).replace(/\\/g, '/');
    if (rel === 'src/permissions') return;
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    const base = path.basename(src);
    // Do not include Firefox manifest in Chromium artifact
    if (IGNORE_FILES.has(base)) return;
    // Skip markdown docs
    if (base.endsWith('.md')) return;
    fs.copyFileSync(src, dest);
  }
}

(function main() {
  ensureDir(outDir);
  // Clean outDir (best-effort)
  for (const entry of fs.readdirSync(outDir)) {
    const p = path.join(outDir, entry);
    fs.rmSync(p, { recursive: true, force: true });
  }
  // Copy allowed files
  copyRecursive(root, outDir);

  // Merge base manifest with optional target overlay
  const basePath = path.join(root, 'manifest.json');
  if (!fs.existsSync(basePath)) {
    console.error('Base manifest.json not found');
    process.exit(1);
  }
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const overlayPath = path.join(root, `manifest.${target}.json`);
  let result = base;
  if (fs.existsSync(overlayPath)) {
    const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
    result = deepMerge(base, overlay);
  }
  const destManifest = path.join(outDir, 'manifest.json');
  fs.writeFileSync(destManifest, JSON.stringify(result, null, 2));

  console.log(`${target} build prepared at`, outDir);
})();
