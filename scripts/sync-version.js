// Single source of truth for the version: APP_VERSION in web/js/config.js.
// Writes it into package.json and prints values for CI (version, Android versionCode).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const cfg = fs.readFileSync(path.join(root, 'web/js/config.js'), 'utf8');
const m = /APP_VERSION\s*=\s*'(\d+)\.(\d+)\.(\d+)'/.exec(cfg);
if (!m) { console.error('APP_VERSION not found in web/js/config.js'); process.exit(1); }
const version = `${m[1]}.${m[2]}.${m[3]}`;
const code = (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3]);   // 0.5.1 -> 501, 1.2.3 -> 10203
const pkgFile = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
if (pkg.version !== version) { pkg.version = version; fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n'); }
const out = `version=${version}\ncode=${code}\n`;
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, out);
process.stdout.write(out);
