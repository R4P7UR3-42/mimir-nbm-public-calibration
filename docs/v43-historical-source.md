# Frozen NBM v4.3 native-Q95 historical source lanes

The historical source window contains exactly 100 common market dates from `2026-01-07` through `2026-04-16`. These
dates sit wholly inside NOAA's operational NBM v4.3 interval and before the May 2026 v5 transition. For each market
date, `v43-f042` reads the prior-day 12Z `24-42 hour max` Q95 message. The `v43-f066` lane reads the two-day-prior 12Z
Q95 message with step range `48-66 hour max`. The resulting source-run windows are `2026-01-06`–`2026-04-15` and
`2026-01-05`–`2026-04-14`, respectively.

NOAA's official [NBM versions](https://vlab.noaa.gov/web/mdl/nbm-versions) page identifies v4.3 as the predecessor to
the May 5, 2026 v5 implementation. Representative official archive indexes expose the exact retained native fields:

- [2026-01-06 f042 index](https://noaa-nbm-grib2-pds.s3.amazonaws.com/blend.20260106/12/qmd/blend.t12z.qmd.f042.co.grib2.idx)
- [2026-01-05 f066 index](https://noaa-nbm-grib2-pds.s3.amazonaws.com/blend.20260105/12/qmd/blend.t12z.qmd.f066.co.grib2.idx)

The earlier Mimir
[v4.3 Q90 decision](https://github.com/R4P7UR3-42/Mimir/blob/main/docs/adr/2026-08-28-noaa-nbm-v43-q90-external-validation.md)
stopped before bulk acquisition or outcome inspection because it inspected station bulletins and the wrong forecast
horizon. It did not inspect these native f042/f066 Q95 messages. The present lanes preserve only the source half of a
new calibration question and still require a separate reviewed outcome/evaluator decision.

The two horizons use different capture schemas, decoder schemas, source-product identities, and artifacts. They cannot
pool with each other or with current v5 evidence. One common market date remains one independent date, not two. No
historical quote, execution, fill, profitability, recommendation, capital, trading, production, or outcome evidence is
collected. Workflow artifacts expire after 30 days and are not durable evidence authority.

After all four artifacts for one profile are placed under one `/var/tmp` root with direct `YYYY-MM-DD` children, create
that horizon's deterministic 2,000-row source artifact with:

```sh
deno task aggregate:v43-source -- \
  --input-root /var/tmp/nbm-v43-f042-complete \
  --output /var/tmp/nbm-v43-f042-horizon.json \
  --source-profile v43-f042
```

Run the command separately with `v43-f066`; it rejects current-v5 profiles, missing or duplicate dates, checksum drift,
authority drift, mixed horizons, and output overwrite. The artifact identifies itself as an adaptive historical holdout
with `independent_oos=false`; it contains source forecasts only.

Acquire the exact official integer-TMAX outcome artifact once, then evaluate both checksum-bound horizons together:

```sh
deno task acquire:v43-outcomes -- \
  --stations data/stations.json \
  --output /var/tmp/nbm-v43-outcomes.json

deno task evaluate:v43 -- \
  --f042 /var/tmp/nbm-v43-f042-horizon.json \
  --f066 /var/tmp/nbm-v43-f066-horizon.json \
  --outcomes /var/tmp/nbm-v43-outcomes.json \
  --output /var/tmp/nbm-v43-evaluation.json
```

Outcome acquisition has a two-request total budget, never retries, and treats HTTP 429 as terminal. The evaluator
requires complete exact station/date coverage, verifies every artifact checksum and source/run identity, and scores
`official integer TMAX <= floor(native Q95)`. It uses 10,000 fixed-seed whole-market-date bootstrap resamples for each
horizon and station leave-one-out slice. The horizons share the same 100 market-date clusters and cannot be reported as
200 independent dates. Because the family was selected after related NBM development, this remains an adaptive
historical holdout: a failure can falsify the family quickly, while a pass cannot authorize trading or support a profit
claim without prospective independent evidence and executable fills.
