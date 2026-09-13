// Deadline Desk watcher — daily change detection over structured boards and org pages.
// Detection only: it notices that something changed; a human (or the weekly sweep)
// verifies before anything reaches data/opportunities.json.
//
//   node scripts/watch.mjs             # diff against state/, write reports/YYYY-MM-DD.md
//   node scripts/watch.mjs --seed      # first run: record state, report nothing
//
// Exit code: 0 always. "NEW__" markers in the report are what the CI issue step greps for.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WATCHLIST = JSON.parse(fs.readFileSync(path.join(root, 'data/watchlist.json'), 'utf8'));
const STATE_PATH = path.join(root, 'state/watch-state.json');
const state = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : {};
const seed = process.argv.includes('--seed');
const UA = 'Mozilla/5.0 (compatible; DeadlineDeskWatcher/1.0; +https://iitianvibes.com/blog/deadline-desk)';
const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { err: `http ${r.status}` };
    return { body: await r.text() };
  } catch (e) {
    clearTimeout(t);
    // Some .gov.in TLS chains fail Node's fetch; curl accepts them.
    try {
      const { execFileSync } = await import('node:child_process');
      const body = execFileSync('curl', ['-sSL', '-k', '-A', UA, '--max-time', '25', url], { encoding: 'utf8', maxBuffer: 8e6 });
      if (body) return { body };
    } catch {}
    return { err: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  }
}

const norm = (s) => s.toLowerCase();
const matches = (title, filter) => !filter?.length || filter.some((k) => norm(title).includes(norm(k)));

// Board sources → a map of {id: title} for filtered postings.
async function fetchBoard(src) {
  if (src.type === 'greenhouse' || src.type === 'greenhouse-eu') {
    const host = src.type === 'greenhouse' ? 'boards-api.greenhouse.io' : 'boards.eu.greenhouse.io';
    const { body, err } = await get(`https://${host}/v1/boards/${src.slug}/jobs`);
    if (err) return { err };
    const jobs = JSON.parse(body).jobs ?? [];
    const items = {};
    for (const j of jobs) if (matches(j.title, src.filter)) items[String(j.id)] = `${j.title} — ${j.location?.name ?? ''} — ${j.absolute_url}`;
    return { items, total: jobs.length };
  }
  if (src.type === 'amazon') {
    const { body, err } = await get(src.url);
    if (err) return { err };
    const jobs = JSON.parse(body).jobs ?? [];
    const items = {};
    for (const j of jobs) if (matches(j.title ?? '', src.filter)) items[String(j.id_icims ?? j.id)] = `${j.title} — ${j.location ?? ''} — https://www.amazon.jobs${j.job_path ?? ''}`;
    return { items, total: jobs.length };
  }
  return { err: `unknown type ${src.type}` };
}

// Page sources → visible text, so diffs read as changed lines, not hashes.
function pageText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n').replace(/&nbsp;|&amp;|&#\d+;|&[a-z]+;/gi, ' ')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 3)
    .slice(0, 1500).join('\n').slice(0, 40000);
}

const lines = [];
const newMarkers = [];
let checked = 0, errors = 0;

for (const src of WATCHLIST) {
  await sleep(300);
  checked++;
  const prev = state[src.id];
  if (src.type === 'page') {
    const { body, err } = await get(src.url);
    if (err) { errors++; lines.push(`- ERROR ${src.id} (${src.org}): ${err}`); state[src.id] = { ...prev, lastChecked: today, error: err }; continue; }
    const text = pageText(body);
    if (!prev?.text) { state[src.id] = { text, lastChecked: today, lastChanged: today }; continue; }
    if (prev.text !== text && !seed) {
      const prevSet = new Set(prev.text.split('\n'));
      const added = text.split('\n').filter((l) => !prevSet.has(l)).slice(0, 6);
      if (added.length) {
        newMarkers.push(src.id);
        lines.push(`### NEW__ ${src.org} — page changed (${src.url})`);
        if (src.note) lines.push(`  _watching for: ${src.note}_`);
        for (const a of added) lines.push(`  + ${a.slice(0, 160)}`);
        lines.push('');
      }
      state[src.id] = { text, lastChecked: today, lastChanged: today };
    } else {
      state[src.id] = { ...prev, text, lastChecked: today };
    }
  } else {
    const { items, total, err } = await fetchBoard(src);
    if (err) { errors++; lines.push(`- ERROR ${src.id} (${src.org}): ${err}`); state[src.id] = { ...prev, lastChecked: today, error: err }; continue; }
    const prevIds = new Set(Object.keys(prev?.items ?? {}));
    const added = Object.entries(items).filter(([id]) => !prevIds.has(id));
    const removed = [...prevIds].filter((id) => !(id in items));
    if (prev?.items && !seed && (added.length || removed.length)) {
      if (added.length) {
        newMarkers.push(src.id);
        lines.push(`### NEW__ ${src.org} — ${added.length} new posting(s)`);
        for (const [, t] of added) lines.push(`  + ${t}`);
      }
      if (removed.length) lines.push(`  (- ${removed.length} posting(s) closed/removed at ${src.org})`);
      lines.push('');
    }
    state[src.id] = { items, total, lastChecked: today, lastChanged: (added.length || removed.length) ? today : (prev?.lastChanged ?? today) };
  }
}

fs.mkdirSync(path.join(root, 'state'), { recursive: true });
fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 1) + '\n');
const header = `# Watcher report — ${today}\n\n${checked} sources checked · ${newMarkers.length} with new activity · ${errors} errors\n\n`;
const report = header + (lines.length ? lines.join('\n') : '_No changes detected._') + '\n';
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, `reports/${today}.md`), report);
console.log(report);
