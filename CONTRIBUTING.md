# Contributing to Deadline Desk

The bar here is different from other lists: **everything on this board is real and verified.** We would rather miss a posting than publish a wrong one.

## Adding an opportunity

1. Edit `data/opportunities.json` and add one object. Required fields:
   - `id` — kebab-case, `org-name-style`
   - `name`, `org`, `lane` (`A-research` | `A-fellowship` | `B-industry` | `B-govt` | `C-competition`), `sub`, `kind`
   - `what` (one line), `eligibility`, `pay` (verbatim if stated, else `"not stated"`)
   - `status` — `OPEN` (has a deadline), `ROLLING` (live, no deadline), `OPENS_SOON` (org states a future date), `EXPECTED` (previous cycle known, next not announced — say so in `notes`)
   - `deadline` (`YYYY-MM-DD`) for OPEN; optional `deadline_time` (ISO with offset) when the org states an exact time
   - `deadline_quote` — **the verbatim sentence from the organisation's page stating the deadline.** This is the receipt; a row without it will not be merged.
   - `apply_url` and `source_url` — on the **organisation's own domain** (its ATS — Greenhouse/Lever/Ashby/Workday — counts). Internshala, Unstop, LinkedIn cards, Telegram forwards and other aggregators are rejected by CI.
   - `verified_at` — today's date.
2. Run `node scripts/verify.mjs` locally — it probes every link and enforces the rules above.
3. Open a PR. CI runs the same verifier; a maintainer re-reads the source page before merging.

## Fixing or expiring a row

Deadline moved? Update it **with a new `deadline_quote`**. Programme closed with no next date? Delete the row. Next cycle announced? Flip to `OPENS_SOON` with the org's own wording.

## Watching a new source

Add an entry to `data/watchlist.json` (`greenhouse`/`greenhouse-eu`/`amazon` board types, or `page` for text-diff watching). The daily watcher opens an issue when it changes.

## What gets a row

Real money or real prestige, open to students in India (or a note when a group is excluded — we publish eligibility honestly, including "IITs not eligible" when an org says so). Paid-listing spam, MLM "internships", unpaid "exposure" roles: no.

## How this repo connects to iitianvibes.com

Two gates, on purpose:

1. **Into the repo** — your PR must pass CI (`scripts/verify.mjs` probes every link, rejects aggregator hosts, enforces the schema) **and** a maintainer review. Nothing merges on CI alone.
2. **Onto the live board** — the website does **not** auto-deploy from this repo. At each weekly rebuild a maintainer diffs this dataset against the live one, re-reads the source page for anything new, and only then ships. A bad row that somehow slipped through gate 1 dies at gate 2 without ever reaching the site.

The daily watcher runs the other way: it detects changes at the source organisations and opens an issue here, so contributors and maintainers see "X just opened" the day it happens.
