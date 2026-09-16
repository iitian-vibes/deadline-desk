// Deadline Desk watcher — daily change detection over structured boards and org pages.
// Detection only: it notices that something changed; a human (or the weekly sweep)
// verifies before anything reaches data/opportunities.json.
//
//   node scripts/watch.mjs             # diff against state/, write reports/YYYY-MM-DD.md
//   node scripts/watch.mjs --seed      # first run: record state, report nothing
//   node scripts/watch.mjs --dry --only=page-sih,page-gate   # test a few sources, write nothing
//   WATCH_CI=1 node scripts/watch.mjs   # CI: skips sources marked "ci": false (geo/bot-walled for datacenter IPs)
//   node scripts/watch.mjs --local      # from a machine in India: ONLY the "ci": false sources; then scripts/push-state.sh
//
// Page sources that 403/timeout for plain fetch+curl are retried through headless
// Chromium when `playwright` is importable (CI installs it; local runs skip silently).
// A page change only counts as NEW__ when an added line looks like a deadline/opening
// (see SIGNAL); nav/video/footer churn is recorded but filed under "minor".
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
const dry = process.argv.includes('--dry');
const onlyArg = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const ONLY = onlyArg ? new Set(onlyArg.split(',')) : null;
const CI = !!process.env.WATCH_CI;
const LOCAL = process.argv.includes('--local');

// What a deadline-ish line looks like. Anything else added to a page is churn.
const SIGNAL = /\b(deadline|last date|closes?|closing|closed|apply|applications?|registration|register|opens?|opening|due|submission|submit|nominat|announce|notification|advertisement|advt|recruit|vacanc|intake|call for|walk-?in|extended)\b|\b(20(2[6-9]))\b|\b\d{1,2}(st|nd|rd|th)?[\s-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
const KEYWORD = /\b(deadline|last date|closes?|closing|closed|apply|applications?|registration|register|opens?|opening|due|submission|submit|nominat|announce|notification|advertisement|advt|recruit|vacanc|intake|call for|walk-?in|extended)\b/i;
// A bare date ("- 16 Sep, 2026") is a page's last-updated stamp, not news; a date needs a sentence around it.
const DATED = /\b\d{1,2}(st|nd|rd|th)?[\s-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;
// Keyword lines need a sentence (a "Submit" button is 1 word); dated lines need a sentence too. A year on its own is never news.
const isSignal = (line) => { const w = line.split(/\s+/).length; return (KEYWORD.test(line) && w >= 3) || (DATED.test(line) && w >= 5); };
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

// Headless-Chromium fallback for bot-walled pages (SIH, MEXT, IUSSTF, Brandstorm all 403 plain fetch).
let _pw = null;
async function getWithBrowser(url) {
  try { _pw ??= await import('playwright'); } catch { return { err: 'blocked (no browser available)' }; }
  let browser;
  try {
    browser = await _pw.chromium.launch();
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', locale: 'en-IN', ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1500);
    const body = await page.content();
    const status = resp?.status() ?? 0;
    if (status >= 400 || body.length < 2000) return { err: `browser http ${status} (${body.length} bytes)` };
    return { body, via: 'browser' };
  } catch (e) {
    return { err: `browser: ${String(e.message || e).split('\n')[0].slice(0, 80)}` };
  } finally { await browser?.close(); }
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
const minorLines = [];
const drafts = [];   // one stub per signal hit → data/drafts/<date>.json for the draft-PR step
const newMarkers = [];
let checked = 0, errors = 0;

let minor = 0;
const manual = [];
for (const src of WATCHLIST) {
  if (ONLY && !ONLY.has(src.id)) continue;
  if (LOCAL && src.ci !== false) continue;
  if (CI && src.ci === false) { manual.push(`- ${src.org}: ${src.url} — ${src.note ?? ''} (run \`node scripts/watch.mjs --local\` from India)`); continue; }
  await sleep(300);
  checked++;
  const prev = state[src.id];
  if (src.type === 'manual') { manual.push(`- ${src.org}: ${src.url} — ${src.note ?? ''}`); continue; }
  if (src.type === 'page') {
    let { body, err } = await get(src.url);
    if (err && /http 40[0-9]|timeout|fetch failed|ECONNRESET|blocked/i.test(err)) {
      const b = await getWithBrowser(src.url);
      if (!b.err) { body = b.body; err = undefined; }
      else err = `${err}; ${b.err}`;
    }
    if (err) { errors++; lines.push(`- ERROR ${src.id} (${src.org}): ${err}`); state[src.id] = { ...prev, lastChecked: today, error: err }; continue; }
    const text = pageText(body);
    if (!prev?.text) { state[src.id] = { text, lastChecked: today, lastChanged: today }; continue; }
    if (prev.text !== text && !seed) {
      const prevSet = new Set(prev.text.split('\n'));
      const addedAll = text.split('\n').filter((l) => !prevSet.has(l));
      const added = [...new Set(addedAll.filter(isSignal))].slice(0, 8);
      if (added.length) {
        newMarkers.push(src.id);
        lines.push(`### NEW__ ${src.org} — page changed (${src.url})`);
        if (src.note) lines.push(`  _watching for: ${src.note}_`);
        for (const a of added) lines.push(`  + ${a.slice(0, 160)}`);
        lines.push('');
        drafts.push({ src, quote: added[0] });
      } else if (addedAll.length) {
        minor++;
        minorLines.push(`- minor: ${src.org} (${addedAll.length} changed line(s), none deadline-shaped)`);
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
        for (const [, t] of added.slice(0, 3)) drafts.push({ src, quote: t });
      }
      if (removed.length) lines.push(`  (- ${removed.length} posting(s) closed/removed at ${src.org})`);
      lines.push('');
    }
    state[src.id] = { items, total, lastChecked: today, lastChanged: (added.length || removed.length) ? today : (prev?.lastChanged ?? today) };
  }
}

const header = `# Watcher report — ${today}\n\n${checked} sources checked · ${newMarkers.length} with new activity · ${minor} minor · ${errors} errors\n\n`;
const minorBlock = minorLines.length ? `\n<details><summary>${minorLines.length} page(s) changed without a deadline-shaped line</summary>\n\n${minorLines.join('\n')}\n</details>\n` : '';
const manualBlock = manual.length ? `\n**Not fetched from CI (bot-walled or geo-blocked):**\n${manual.join('\n')}\n` : '';
const report = header + (lines.length ? lines.join('\n') : '_No changes detected._') + '\n' + minorBlock + manualBlock;
console.log(report);
if (dry) { console.log('(dry run — nothing written)'); process.exit(0); }

fs.mkdirSync(path.join(root, 'state'), { recursive: true });
fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 1) + '\n');
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, `reports/${today}${LOCAL ? '-local' : ''}.md`), report);
// One line per day, so the trend is readable without opening 30 files.
fs.appendFileSync(path.join(root, 'reports/digest.md'), `${today}${LOCAL ? ' (local)' : ''} · ${checked} checked · ${newMarkers.length} signal · ${minor} minor · ${errors} errors\n`);

// Draft rows: every signal hit becomes a stub in the dataset's shape with the receipt
// pre-filled. The draft-PR step in CI opens a PR from these; a human fills the TODOs.
if (drafts.length) {
  const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const stubs = drafts.map(({ src, quote }) => ({
    id: `${slug(src.org)}-${slug(quote.split(' — ')[0]).slice(0, 40)}-DRAFT`,
    name: 'TODO — from watcher hit',
    org: src.org,
    lane: 'TODO A-research | A-fellowship | B-industry | B-govt | C-competition | D-mba',
    sub: 'TODO', kind: 'TODO', what: 'TODO', eligibility: 'TODO — must state who can apply, incl. year/branch', pay: 'TODO verbatim or "not stated"',
    status: 'OPEN', deadline: 'TODO YYYY-MM-DD',
    deadline_quote: quote.slice(0, 240),
    apply_url: (quote.match(/https?:\/\/\S+/) || [src.url])[0],
    source_url: src.url,
    notes: `Watcher hit ${today}: ${src.note ?? ''}`.trim(),
    verified_at: null,
  }));
  fs.mkdirSync(path.join(root, 'data/drafts'), { recursive: true });
  fs.writeFileSync(path.join(root, `data/drafts/${today}.json`), JSON.stringify(stubs, null, 1) + '\n');
  console.log(`${stubs.length} draft stub(s) → data/drafts/${today}.json`);
}
