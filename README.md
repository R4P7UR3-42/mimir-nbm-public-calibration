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

A separate historical-calibration workflow freezes the common market-date window `2026-01-07` through `2026-04-16`
(exactly 100 dates) inside the NOAA NBM v4.3 regime. Its disjoint `v43-f042` and `v43-f066` profiles map each market
date to the prior-day f042 and two-day-prior f066 12Z objects respectively. Manual dispatch captures one fixed 25-date
shard for both profiles on public standard runners with at most two concurrent jobs and exactly two NOAA requests per
profile/date. It uploads source-only artifacts and never commits evidence. Historical calibration cannot receive quote,
execution, fill, profit, recommendation, capital, trading, or current-v5 evidence credit. A separate bounded aggregate
task verifies all 100 per-date checksums and emits one deterministic 2,000-row source artifact per horizon; it never
pools f042 and f066. The separate outcome task makes exactly two no-retry NCEI requests for the frozen 20 stations and
100 dates. The evaluator checksum-validates both 2,000-row horizon artifacts and all 2,000 official integer TMAX
outcomes, applies exact `TMAX <= floor(Q95)` arithmetic, and reports fixed-0.95 Brier and deterministic whole-date
cluster-bootstrap diagnostics for each horizon separately. This adaptive holdout can quickly falsify the family, but it
is not independent OOS, execution, fill, profit, capital, recommendation, order, or activation evidence.

An independent f066 source lane captures the two-day-prior 12Z `48-66 hour max fcst:95% level` message each day at 20:35
UTC, assigns the market date two days ahead, and persists it create-once under `evidence-f066/YYYY-MM-DD/`. Its
prospective threshold-dominance hypothesis is frozen separately in
[`docs/f066-threshold-dominance-oos.md`](docs/f066-threshold-dominance-oos.md); it begins on 2026-09-03 and grants no
trading authority. The original f042 workflow, schemas, schedule, and `evidence/` namespace remain unchanged.

After the first 50 v4.3 dates showed severe raw-Q95 undercoverage, the distinct
[`floor(Q95)+3°F` adaptive freeze](docs/f066-q95-plus-three-adaptive-freeze.md) reserved the untouched final 50 v4.3
dates for falsification and a separate zero-credit current-v5 prospective ledger beginning September 3. The v4.3 and v5
identities never pool, and neither grants trading authority.

That frozen `floor(Q95)+3°F` decision has a separate
[50-date adaptive holdout evaluator](docs/f066-q95-plus-three-adaptive-freeze.md#historical-evaluator). It grants the
inspected first 50 dates zero holdout credit and evaluates only February 26 through April 16 as whole-date clusters. The
evaluator is local, checksum-bound, create-once, network-free, and authority-free.

The complete reviewed v4.3 source/outcome/evaluation tree is now
[durable and root-manifest verified](docs/v43-reviewed-artifacts.md) in this repository rather than depending on
expiring workflow artifacts or `/var/tmp`.

The separate [public execution-proxy exporter](docs/v43-public-execution-proxy.md) can inspect the frozen v4.3 f042
window and the exact buffered f066 plus-three holdout without credentials or a database. It binds exact daily
high-temperature contracts and NWS settlement products before reading one-minute historical top-of-book candles and
exact-ticker public trades. The f066 lane uses only its final 50 dates, exact `floor(Q95)+3°F` strike, and strict
prior-day `[14:00Z,18:00Z)` window. Candles contain no depth or within-minute quote sequence, public trades are not
member fills, and the exporter always reports zero provider-confirmed fills. It is a bounded price/reachability
falsification aid, not exact prospective selection, execution, profit, recommendation, capital, order, trading, or
production evidence. Raw f066 and adjacent identities remain zero-network rejections.

The buffered f066 proxy now has a deterministic
[exact-fee historical economics evaluation](docs/v43-f066-plus-three-exact-fee-economics.md). Six in-band rows were 5/6
but lost `-$0.7669` after exact fees; only one row cleared the `$0.015` edge floor. Its `1/50` date support, zero depth,
zero fills, and adaptive historical status make promotion explicitly not ready.

Run locally only in an isolated environment:

```sh
deno run --allow-read=. --allow-write=/var/tmp --allow-run=python3 \
  --allow-net=noaa-nbm-grib2-pds.s3.amazonaws.com:443 scripts/capture.ts \
  --market-date 2026-09-01 --output-dir /var/tmp/nbm-q95-canary --max-requests 2
```
