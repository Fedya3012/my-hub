// Single source of truth for the version: APP_VERSION in web/js/config.js, written x.y.z.w (e.g. 0.7.0.1).
// Four parts so the number grows slowly: bump the last one for small updates.
// Writes package.json (version = a semver-valid mapping, because electron-builder/electron-updater need
// three parts; displayVersion = the real one) and prints values for CI (version, Android versionCode).
//   semver  x.y.(z*100+w)                 0.7.0.1 -> 0.7.1, 0.7.1.0 -> 0.7.100   (never goes backwards)
//   code    x*1000000 + y*10000 + z*100 + w   0.7.0.1 -> 70001 (above the old 3-part codes, e.g. 700)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const cfg = fs.readFileSync(path.join(root, 'web/js/config.js'), 'utf8');
const m = /APP_VERSION\s*=\s*'(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?'/.exec(cfg);
if (!m) { console.error('APP_VERSION (x.y.z.w) not found in web/js/config.js'); process.exit(1); }
const [x, y, z, w] = [+m[1], +m[2], +m[3], +(m[4] || 0)];
if (w > 99 || z > 99 || y > 99) { console.error('Version parts above 99 are not supported'); process.exit(1); }
const version = `${x}.${y}.${z}.${w}`;
const semver = `${x}.${y}.${z * 100 + w}`;
const code = x * 1000000 + y * 10000 + z * 100 + w;
const pkgFile = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
if (pkg.version !== semver || pkg.displayVersion !== version) { pkg.version = semver; pkg.displayVersion = version; fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n'); }
const out = `version=${version}\ncode=${code}\nsemver=${semver}\n`;
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, out);
process.stdout.write(out);
