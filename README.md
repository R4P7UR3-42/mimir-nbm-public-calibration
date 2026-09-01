# NOAA NBM native MaxT Q95 public calibration

Credential-free, order-free source-feasibility capture for one exact NOAA NBM QMD field:

`TMP:2 m above ground:24-42 hour max fcst:95% level`

The canary reads the prior-day 12Z f042 public object for one market date, makes exactly two HTTP requests (index plus
one byte range), decodes the frozen 20-station inventory with pinned ecCodes, and publishes checksum-bound evidence.

The default-branch workflow runs daily at 20:20 UTC, after the frozen 20:00 UTC source-availability deadline. Scheduled
runs deterministically assign the next UTC date as the market date; manual runs retain an explicit `market_date` input.
Runs share one non-cancelling concurrency group and time out after 20 minutes. Every first successful date is committed
create-once under `evidence/YYYY-MM-DD/`, where `SHA256SUMS` covers both `evidence.json` and a provenance manifest that
binds the workflow-start SHA and run identity. Thirty-day Actions artifacts are convenience copies, not evidence
authority. A rerun verifies the durable files before any NOAA request and skips capture when that exact date already
exists; malformed, partial, or changed evidence fails closed and is never overwritten.

This repository contains no Kalshi client, credentials, private data, production access, recommendation logic, order
logic, capital authority, or trading authority. Every artifact explicitly records source-only status and false
recommendation, order, capital, trading, and production-activation authority. A successful canary establishes source
feasibility only.

Run locally only in an isolated environment:

```sh
deno run --allow-read=. --allow-write=/var/tmp --allow-run=python3 \
  --allow-net=noaa-nbm-grib2-pds.s3.amazonaws.com:443 scripts/capture.ts \
  --market-date 2026-09-01 --output-dir /var/tmp/nbm-q95-canary --max-requests 2
```
