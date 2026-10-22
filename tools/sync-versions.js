#!/usr/bin/env node
// Keeps web/version.json in line with the code, so App Manager and the Service Worker agree:
//   - modules.<id>.name / version come from js/modules/<id>/manifest.js (the source of truth);
//   - modules.<id>.files lists every file in js/modules/<id>/ (plus any outside files already listed);
//   - shell.files drops paths that no longer exist (one missing file makes the whole
//     Service Worker install fail) and adds new core JS/CSS files.
// Usage: node tools/sync-versions.js          rewrite version.json
//        node tools/sync-versions.js --check  only report, exit 1 if anything is out of date (CI)
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'web');
const VERSION_FILE = path.join(WEB, 'version.json');
const check = process.argv.includes('--check');

const walk = (dir) => fs.readdirSync(path.join(WEB, dir), { withFileTypes: true }).flatMap(e => {
  const rel = dir + '/' + e.name;
  return e.isDirectory() ? walk(rel) : [rel];
});
const exists = (f) => f === './' || fs.existsSync(path.join(WEB, f));

async function loadManifest(id) {
  const src = fs.readFileSync(path.join(WEB, 'js/modules', id, 'manifest.js'), 'utf8');
  return (await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(src))).default;
}

(async () => {
  const before = fs.readFileSync(VERSION_FILE, 'utf8');
  const v = JSON.parse(before);
  const problems = [];

  const ids = fs.readdirSync(path.join(WEB, 'js/modules')).filter(id => exists(`js/modules/${id}/manifest.js`));
  for (const id of ids) {
    const m = await loadManifest(id);
    if (m.status === 'planned') continue;
    const entry = v.modules[id] || (v.modules[id] = { name: m.name, version: m.version, minApp: v.app, files: [], changelog: [] });
    if (entry.version !== m.version) problems.push(`${id}: version.json ${entry.version} ≠ manifest ${m.version}`);
    if (entry.name !== m.name) problems.push(`${id}: name "${entry.name}" ≠ manifest "${m.name}"`);
    entry.name = m.name;
    entry.version = m.version;
    const own = walk(`js/modules/${id}`).filter(f => !f.endsWith('/manifest.js'));
    const kept = (entry.files || []).filter(f => {
      if (exists(f)) return true;
      problems.push(`${id}: listed file missing: ${f}`);
      return false;
    });
    const added = own.filter(f => !kept.includes(f)).sort();
    added.forEach(f => problems.push(`${id}: file not listed: ${f}`));
    entry.files = [...kept, ...added];
  }

  const shell = v.shell.files;
  const kept = shell.filter(f => {
    if (exists(f)) return true;
    problems.push(`shell: listed file missing: ${f}`);
    return false;
  });
  const core = [...fs.readdirSync(path.join(WEB, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f),
    ...walk('js/core'), ...walk('css'), ...ids.map(id => `js/modules/${id}/manifest.js`)];
  const added = core.filter(f => !kept.includes(f)).sort();
  added.forEach(f => problems.push(`shell: file not listed: ${f}`));
  v.shell.files = [...kept, ...added];

  if (!problems.length) { console.log('version.json is up to date.'); return; }
  console.log(problems.join('\n'));
  if (check) {
    console.error('\nversion.json is out of date: run `node tools/sync-versions.js` and commit.');
    process.exit(1);
  }
  fs.writeFileSync(VERSION_FILE, JSON.stringify(v, null, 2) + '\n');
  console.log('\nversion.json updated.');
})();
