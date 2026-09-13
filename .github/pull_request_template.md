## What this PR adds or fixes

<!-- one line per row touched -->

## The receipts checklist (required)

- [ ] `apply_url` and `source_url` are on the **organisation's own domain** (or its ATS — Greenhouse/Lever/Ashby/Workday). No Internshala, Unstop, LinkedIn cards, Telegram forwards.
- [ ] `deadline_quote` is the **verbatim sentence** from that page stating the deadline (or that applications are open/rolling).
- [ ] `status` is honest: `EXPECTED` rows say "previous cycle; next not announced" in `notes`.
- [ ] `verified_at` is today.
- [ ] I ran `node scripts/verify.mjs` locally and it passed.

> Note: a merge here updates **this repository**. The live board at
> [iitianvibes.com/blog/deadline-desk](https://iitianvibes.com/blog/deadline-desk/) adopts merged rows
> at its next rebuild, after a maintainer re-reads the source page. Merge ≠ instant site update — by design.
