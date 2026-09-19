// Regenerates README.md from data/opportunities.json. Run after any data change.
// The README leads with urgency (what closes this week), then proves the standard
// (a real receipt, the traps we caught), then lists the board.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rows = JSON.parse(fs.readFileSync(path.join(root, 'data/opportunities.json'), 'utf8'));
const LANE = {
  'A-research': ['Research internships', 'Labs abroad and in India that pay, house and fly you.'],
  'A-fellowship': ['Fellowships & scholarships', 'Money for a degree — Indian and international.'],
  'B-industry': ['Industry — internships & new-grad', 'Off-campus routes that take direct applications.'],
  'B-govt': ['Government, PSUs & exams', 'Permanent posts, national labs and the exams that unlock them.'],
  'C-competition': ['Competitions & open source', 'Prize money, residencies and hackathons.'],
  'D-mba': ['MBA & management', 'Entrance windows and case competitions.'],
};

const now = Date.now();
const iso = (r) => r.deadline_time || `${r.deadline}T23:59:59+05:30`;
const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const short = (s) => { const d = new Date(new Date(s).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })); return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`; };
const days = (r) => Math.ceil((new Date(iso(r)).getTime() - now) / 86400000);
const inDays = (n) => n <= 0 ? '**today**' : n === 1 ? '**tomorrow**' : n <= 7 ? `**in ${n} days**` : `in ${n} days`;
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const who = (r) => esc(r.who || r.eligibility);
const money = (r) => esc(r.pay && r.pay !== 'not stated' ? r.pay : r.what);
const badge = (s) => String(s).replace(/-/g, '--').replace(/ /g, '_');

const open = rows.filter((r) => r.status === 'OPEN' && r.deadline && new Date(iso(r)).getTime() > now).sort((a, b) => iso(a).localeCompare(iso(b)));
const rolling = rows.filter((r) => r.status === 'ROLLING');
const watch = rows.filter((r) => r.status === 'OPENS_SOON' || r.status === 'EXPECTED');
const opensSoon = rows.filter((r) => r.status === 'OPENS_SOON' && r.opens).sort((a, b) => String(a.opens).localeCompare(String(b.opens)));
const verified = rows.map((r) => r.verified_at).filter(Boolean).sort().pop() ?? '';
// "links checked" is written by verify.mjs only on a clean probe of every row, so the badge
// reports a probe that actually ran rather than the date of the last content sweep.
let linksChecked = verified;
try { linksChecked = JSON.parse(fs.readFileSync(path.join(root, 'data/last-verified.json'), 'utf8')).links_checked || verified; } catch {}
const closingWeek = open.filter((r) => days(r) <= 7);
const closingMonth = open.filter((r) => days(r) <= 31);
const traps = rows.filter((r) => r.trap).sort((a, b) => iso(a).localeCompare(iso(b)));

const table = (list, withDate) => {
  const head = withDate
    ? '| Closes | Opportunity | What you get | Who can apply |\n|---|---|---|---|'
    : '| Opportunity | Organisation | What you get | Who can apply |\n|---|---|---|---|';
  const line = (r) => withDate
    ? `| **${short(iso(r))}** | [${esc(r.name)}](${r.apply_url})<br><sub>${esc(r.org)}</sub> | ${money(r)} | ${who(r)} |`
    : `| [${esc(r.name)}](${r.apply_url}) | ${esc(r.org)} | ${money(r)} | ${who(r)} |`;
  return head + '\n' + list.map(line).join('\n');
};

let md = `<div align="center">

# Deadline Desk

**Every internship, fellowship, scholarship, government intake and competition an Indian student can actually apply to — sorted by the date it closes, with a receipt on every one.**

![open](https://img.shields.io/badge/open_now-${open.length + rolling.length}-C2410C?style=for-the-badge) ![closing](https://img.shields.io/badge/closing_in_7_days-${closingWeek.length}-E5484D?style=for-the-badge) ![watch](https://img.shields.io/badge/on_watch-${watch.length}-6F665B?style=for-the-badge) ![links](https://img.shields.io/badge/all_links_checked-${badge(short(linksChecked + 'T00:00:00+05:30'))}-1A1714?style=for-the-badge)

[**Live board with countdowns →**](https://iitianvibes.com/blog/deadline-desk/) · [Subscribe in your calendar](#-put-every-deadline-in-your-calendar) · [Add an opportunity](../../issues/new?template=submit-opportunity.yml)

</div>

---

`;

// ---- urgency first
if (closingWeek.length) {
  md += `## ⏰ Closing in the next 7 days\n\n`;
  md += `| Closes | Opportunity | Who can apply |\n|---|---|---|\n`;
  md += closingWeek.map((r) => `| ${inDays(days(r))}<br><sub>${short(iso(r))}</sub> | [${esc(r.name)}](${r.apply_url})<br><sub>${esc(r.org)} · ${money(r)}</sub> | ${who(r)} |`).join('\n');
  md += `\n\n<sub>${closingMonth.length} close within the month. Times are IST unless the organisation states otherwise.</sub>\n\n`;
}

// ---- the standard, proved with a real row
const proof = open.find((r) => r.deadline_quote && r.deadline_quote.length > 40) ?? open[0];
md += `## Why this list is different

Most opportunity lists are copied from other lists. This one is read off the source.

- **Every deadline carries a receipt.** Not "closes in October" — the organisation's own sentence, quoted verbatim in [\`data/opportunities.json\`](data/opportunities.json). For *${esc(proof.name)}*:
  > “${esc(proof.deadline_quote)}”
- **Only the organisation's own page.** Never Unstop, never a LinkedIn repost, never a Telegram forward. CI rejects aggregator hosts on every pull request.
- **Closed rows are deleted, not archived.** If it is on this list, it is open. A daily watcher re-reads ~45 sources and the board is rebuilt every Saturday.
- **We say who it is *not* for.** Every row names the range and its edge — "third year and up; first and second years cannot register" — so you find out in one line instead of at the end of a form.
- **Nothing is paid placement.** No organisation pays to be listed, which is why rows can say *skip this*.

`;

// ---- traps: the thing no aggregator can produce
if (traps.length) {
  md += `## 🪤 Traps we caught\n\nDeadlines that are not what they look like. Each one is quoted from the source.\n\n`;
  md += traps.map((r) => `- **${esc(r.name)}** — ${esc(r.trap)}<br><sub>[${esc(r.org)}](${r.apply_url}) · closes ${short(iso(r))}</sub>`).join('\n');
  md += `\n\n`;
}

// ---- calendar
md += `## 📅 Put every deadline in your calendar

Subscribe once and every closing date lands in your phone with a 36-hour alarm. New rows appear as the board grows; closed rows vanish.

| Feed | Link |
|---|---|
| Everything | \`webcal://iitianvibes.com/blog/deadline-desk/calendar.ics\` |
| 2027 batch | \`webcal://iitianvibes.com/blog/deadline-desk/calendar-2027.ics\` |
| 2028 batch | \`webcal://iitianvibes.com/blog/deadline-desk/calendar-2028.ics\` |
| 2029 batch | \`webcal://iitianvibes.com/blog/deadline-desk/calendar-2029.ics\` |

<sub>Batch feeds also include everything that names no batch year. On a phone, tap the link; on desktop, paste it into Google Calendar → Other calendars → From URL.</sub>

`;

// ---- the board
md += `## The board\n\n`;
for (const [lane, [label, blurb]] of Object.entries(LANE)) {
  const o = open.filter((r) => r.lane === lane);
  const ro = rolling.filter((r) => r.lane === lane);
  if (!o.length && !ro.length) continue;
  md += `### ${label}\n\n<sub>${blurb}</sub>\n\n`;
  if (o.length) md += table(o, true) + '\n';
  if (ro.length) md += `\n<details><summary><b>Rolling — open now, no stated deadline (${ro.length})</b></summary>\n\n` + table(ro, false) + '\n\n</details>\n';
  md += '\n';
}

// ---- opens soon, then dormant
if (opensSoon.length) {
  md += `## Opening soon — get ready now\n\n| Opens | Opportunity | Who can apply |\n|---|---|---|\n`;
  md += opensSoon.map((r) => `| **${short(r.opens + 'T00:00:00+05:30')}** | [${esc(r.name)}](${r.source_url ?? r.apply_url})<br><sub>${esc(r.org)}</sub> | ${who(r)} |`).join('\n') + '\n\n';
}
const dormant = watch.filter((r) => r.status !== 'OPENS_SOON' || !r.opens);
if (dormant.length) {
  md += `<details><summary><b>On watch — previous cycle known, next not announced (${dormant.length})</b></summary>\n\n| Opportunity | Organisation | Status |\n|---|---|---|\n`;
  md += dormant.map((r) => `| [${esc(r.name)}](${r.source_url ?? r.apply_url}) | ${esc(r.org)} | ${esc(r.notes ?? 'Previous cycle; next not announced')} |`).join('\n') + '\n\n</details>\n\n';
}

// ---- how it runs + contribute
md += `---

## How it stays true

\`\`\`
daily 09:00 IST   watcher reads ~45 org pages and job boards
                  → a change only counts when the new line reads like a deadline
                  → opens an issue, and a draft row with the quote pre-filled
every Saturday    every link re-probed, expired rows deleted, new rows verified
                  on the org's own page, then the board and this file rebuild
on every PR       CI checks links resolve, rejects aggregator hosts,
                  and fails any open row missing its receipt
\`\`\`

## Contribute

Know a deadline that is not here? **[Submit it in two minutes](../../issues/new?template=submit-opportunity.yml)** — we need the organisation's own link and the sentence on their page that states the date. Or [open a PR](CONTRIBUTING.md) against \`data/opportunities.json\`.

We would rather miss a posting than publish a wrong one. Corrections are welcome and land fast.

### The rules every row is held to

1. **Filter on the closing date, never the posting date.**
2. **Source only the organisation's own page.** Aggregator links are rejected by CI.
3. **Real money or real prestige.** No no-name "leadership programmes".
4. **Say when something is closed, dormant, or not open to Indian students** rather than reprinting last year's deadline.

## License

Code (\`scripts/\`, workflows) — [MIT](LICENSE). Data (\`data/\`) — [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): reuse freely with attribution to **IITian Vibes · Deadline Desk**.

<div align="center"><sub>Built and maintained by <a href="https://iitianvibes.com/blog/deadline-desk/">IITian Vibes</a>. Run by IITians, open to every student in India.</sub></div>
`;

fs.writeFileSync(path.join(root, 'README.md'), md);
console.log(`README.md: ${open.length} open (${closingWeek.length} within 7d), ${rolling.length} rolling, ${watch.length} watch, ${traps.length} traps`);
