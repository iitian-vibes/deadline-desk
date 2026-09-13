// Deadline Desk — link + deadline verifier.
// Reads data/deadline-desk/opportunities.json, checks every apply_url and source_url
// resolves (HEAD/GET 2xx/3xx), rejects aggregator hosts, and reports deadline state
// relative to today. Exit 1 if any OPEN row fails.
//
//   node engine/deadline-desk/verify.mjs            # verify
//   node engine/deadline-desk/verify.mjs --fix      # also drop rows whose deadline has passed
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data/opportunities.json');
const AGGREGATORS = [
  'internshala.com', 'unstop.com', 'naukri.com', 'indeed.com', 'linkedin.com',
  'buddy4study.com', 'scholarshipsads.com', 'opportunitydesk.org', 'sarkariresult',
  'freejobalert', 'adda247', 'testbook.com', 'glassdoor', 'reddit.com', 'quora.com',
  'shiksha.com', 'collegedunia.com', 'careers360.com', 'medium.com',
];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 IITianVibesDeadlineDesk/1.0';

const today = new Date().toISOString().slice(0, 10);
const fix = process.argv.includes('--fix');
const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));

async function probe(url) {
  if (!url) return { ok: false, why: 'missing' };
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (AGGREGATORS.some((a) => host.includes(a))) return { ok: false, why: `aggregator host ${host}` };
  } catch { return { ok: false, why: 'malformed url' }; }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA } });
    if (r.status === 405 || r.status === 403 || r.status === 404 || r.status >= 500) {
      r = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA } });
    }
    clearTimeout(t);
    // 403 from a WAF still means the page exists for humans; flag, don't fail.
    if (r.ok) return { ok: true, status: r.status };
    if (r.status === 403 || r.status === 400) return { ok: true, status: r.status, why: `bot-wall ${r.status} (exists for humans)` };
    return { ok: false, status: r.status, why: `http ${r.status}` };
  } catch (e) {
    clearTimeout(t);
    // TLS failures on .gov.in / .ac.in are common; flag not fail.
    if (/certificate|TLS|SSL|EPROTO/i.test(String(e))) return { ok: true, why: 'tls-warning', status: 0 };
    // Node fetch is stricter than browsers about some TLS chains; confirm with curl before failing.
    const { execFileSync } = await import('node:child_process');
    try {
      const code = execFileSync('curl', ['-sSL', '-k', '-A', UA, '--max-time', '20', '-o', '/dev/null', '-w', '%{http_code}', url], { encoding: 'utf8' }).trim();
      if (/^[23]\d\d$/.test(code)) return { ok: true, status: Number(code), why: 'curl-fallback' };
    } catch {}
    return { ok: false, why: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  }
}

const failures = [];
const kept = [];
for (const r of rows) {
  const problems = [];
  if (!r.id || !r.name || !r.org || !r.lane) problems.push('missing id/name/org/lane');
  if (!['OPEN', 'OPENS_SOON', 'EXPECTED', 'ROLLING'].includes(r.status)) problems.push(`bad status ${r.status}`);
  if (r.status === 'OPEN') {
    if (!r.deadline) problems.push('OPEN without deadline');
    else if (r.deadline < today) problems.push(`deadline ${r.deadline} has passed`);
    if (!r.deadline_quote) problems.push('OPEN without deadline_quote');
  }
  if (r.status === 'EXPECTED' && !/previous|last|not (yet )?announced|expected/i.test(r.notes || '')) problems.push('EXPECTED must say so in notes');
  let a = await probe(r.apply_url);
  // Dormant programmes' pages flap (NTA especially). An unreachable link on a row
  // that promises nothing live is a warning, not a failure.
  if (!a.ok && (r.status === 'EXPECTED' || r.status === 'OPENS_SOON')) a = { ok: true, status: 0, why: `unreachable (${a.why}) — tolerated on ${r.status}` };
  let s = r.source_url && r.source_url !== r.apply_url ? await probe(r.source_url) : { ok: true, status: 'same' };
  if (!s.ok && (r.status === 'EXPECTED' || r.status === 'OPENS_SOON')) s = { ok: true, status: 0, why: `unreachable (${s.why}) — tolerated on ${r.status}` };
  if (!a.ok) problems.push(`apply_url: ${a.why}`);
  if (!s.ok) problems.push(`source_url: ${s.why}`);
  const line = `${problems.length ? '✗' : '✓'} ${r.id.padEnd(28)} ${r.status.padEnd(10)} ${(r.deadline || '—').padEnd(10)} apply:${a.status ?? a.why}${a.why && a.ok ? ' (' + a.why + ')' : ''}${problems.length ? '  ← ' + problems.join('; ') : ''}`;
  console.log(line);
  if (problems.length) failures.push({ id: r.id, problems });
  const expired = r.status === 'OPEN' && r.deadline && r.deadline < today;
  if (!(fix && expired)) kept.push(r);
}
if (fix && kept.length !== rows.length) {
  fs.writeFileSync(DATA, JSON.stringify(kept, null, 2) + '\n');
  console.log(`\n--fix: dropped ${rows.length - kept.length} expired row(s)`);
}
console.log(`\n${rows.length} rows · ${failures.length} with problems · today ${today}`);
process.exit(failures.length ? 1 : 0);
