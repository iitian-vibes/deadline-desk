// Regenerates README.md from data/opportunities.json. Run after any data change.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rows = JSON.parse(fs.readFileSync(path.join(root, 'data/opportunities.json'), 'utf8'));
const LANE = { 'A-research': 'Research internships', 'A-fellowship': 'Fellowships & scholarships', 'B-industry': 'Industry — internships & new-grad', 'B-govt': 'Government, PSUs & exams', 'C-competition': 'Competitions & open source' };
const now = Date.now();
const iso = (r) => r.deadline_time || `${r.deadline}T23:59:59+05:30`;
const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const short = (s) => { const d = new Date(new Date(s).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })); return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`; };
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const open = rows.filter((r) => r.status === 'OPEN' && r.deadline && new Date(iso(r)).getTime() > now).sort((a, b) => iso(a).localeCompare(iso(b)));
const rolling = rows.filter((r) => r.status === 'ROLLING');
const watch = rows.filter((r) => r.status === 'OPENS_SOON' || r.status === 'EXPECTED');
const verified = rows[0]?.verified_at ?? '';
const table = (list, withDate) => {
  const head = withDate ? '| Closes | Opportunity | Organisation | What you get | Who can apply |\n|---|---|---|---|---|' : '| Opportunity | Organisation | What you get | Who can apply |\n|---|---|---|---|';
  const line = (r) => withDate
    ? `| **${short(iso(r))}** | [${esc(r.name)}](${r.apply_url}) | ${esc(r.org)} | ${esc(r.pay !== 'not stated' ? r.pay : r.what)} | ${esc(r.eligibility)} |`
    : `| [${esc(r.name)}](${r.apply_url}) | ${esc(r.org)} | ${esc(r.pay !== 'not stated' ? r.pay : r.what)} | ${esc(r.eligibility)} |`;
  return head + '\n' + list.map(line).join('\n');
};
let md = `# Deadline Desk\n\n**Verified opportunities for students in India — internships, fellowships, government intakes and competitions — sorted by the date they close.**\n\nEvery row is read on the organisation's own page before it lands here (never an aggregator), and every deadline carries a verbatim quote in [\`data/opportunities.json\`](data/opportunities.json). Expired rows are removed. Rebuilt every Saturday; a daily watcher opens an issue when a tracked source changes.\n\n![open](https://img.shields.io/badge/open_now-${open.length + rolling.length}-C2410C) ![watch](https://img.shields.io/badge/on_watch-${watch.length}-6F665B) ![verified](https://img.shields.io/badge/last_verified-${verified}-1A1714)\n\nMaintained by [IITian Vibes](https://iitianvibes.com/blog/deadline-desk/) — the live board has countdown timers, filters and the receipts. Run by IITians; open to everyone.\n\n> Something missing or wrong? [Open a PR](CONTRIBUTING.md) — CI checks every link against the org's own domain.\n\n`;
for (const [lane, label] of Object.entries(LANE)) {
  const o = open.filter((r) => r.lane === lane);
  const ro = rolling.filter((r) => r.lane === lane);
  if (!o.length && !ro.length) continue;
  md += `\n## ${label}\n\n`;
  if (o.length) md += table(o, true) + '\n';
  if (ro.length) md += `\n<details><summary><b>Rolling — no stated deadline (${ro.length})</b></summary>\n\n` + table(ro, false) + '\n\n</details>\n';
}
md += `\n## On watch — not open yet (${watch.length})\n\n| Opportunity | Organisation | Status |\n|---|---|---|\n` + watch.map((r) => `| [${esc(r.name)}](${r.source_url ?? r.apply_url}) | ${esc(r.org)} | ${esc(r.status === 'OPENS_SOON' && r.opens ? `Opens ${short(r.opens + 'T00:00:00+05:30')}` : r.notes ?? 'Previous cycle; next not announced')} |`).join('\n') + '\n';
md += `\n---\n\n### Rules\n\n1. **Filter on the closing date, never the posting date.**\n2. **Source only the organisation's own page.** Aggregator links are rejected by CI.\n3. **Say when something is closed or dormant** rather than reprinting last year's deadline.\n\n### License\n\nCode (scripts/, workflows) — [MIT](LICENSE). Data (\`data/\`) — [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): reuse freely with attribution to **IITian Vibes · Deadline Desk**.\n`;
fs.writeFileSync(path.join(root, 'README.md'), md);
console.log(`README.md: ${open.length} open, ${rolling.length} rolling, ${watch.length} watch`);
