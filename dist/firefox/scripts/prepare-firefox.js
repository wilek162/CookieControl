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

const IGNORE = new Set(['.git', '.github', 'node_modules', 'dist']);

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    const name = path.basename(src);
    if (IGNORE.has(name)) return;
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    // Skip the Chromium manifest; Firefox will use its own
    if (path.basename(src) === 'manifest.json') return;
    fs.copyFileSync(src, dest);
  }
}

(function main() {
  ensureDir(outDir);
  // Copy all files except the Chromium manifest
  copyRecursive(root, outDir);

  // Overwrite with Firefox manifest
  if (!fs.existsSync(srcManifest)) {
    console.error('manifest.firefox.json not found');
    process.exit(1);
  }
  fs.copyFileSync(srcManifest, destManifest);

  console.log('Firefox build prepared at', outDir);
})();
