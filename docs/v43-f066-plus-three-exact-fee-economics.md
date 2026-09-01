# Buffered f066 exact-fee historical economics proxy

Identity: `noaa_nbm_v43_f066_q95_floor_plus_3_exact_fee_economics_proxy_v1`

This deterministic, network-free evaluator joins the checksum-bound buffered-f066 public execution proxy to the exact
official integer-TMAX outcome artifact. It evaluates only the frozen `2026-02-26` through `2026-04-16` holdout, exact
`greater`/NO `floor(native f066 Q95)+3°F` rows, and first-complete-candle price proxies inside the prior-day
`[14:00Z,18:00Z)` window. It never reconstructs displayed depth or within-minute quote order.

For one contract and one order, the taker fee is exactly `ceil(0.07 × price × (1-price) × 10000) / 10000`. The
fixed-score edge is `0.9500 - price - fee`; exact `$0.0150` passes. Price bounds `$0.7000` and `$0.9700` pass, while
`$0.6999` and `$0.9701` fail. After fee eligibility, candidates are ranked by descending exact edge and then ticker,
with at most three station-distinct selections per whole market date.

## Frozen result

The proxy artifact has embedded SHA-256 `a167d470edbf6b744698bac9ffab3c82d489addbf57c2c85ec00fc256685e762`. It made 218
successful public requests and found 67 exact causal quote proxies. Six prices were inside `$0.70`–`$0.97`; all six had
a compatible public trade, but none had historical depth or a provider-confirmed member fill.

The six-row diagnostic was 5/6 with exact-fee net proxy P&L of `-$0.7669`. Only `KXHIGHNY-26FEB28-T57` at `$0.9300` met
the fixed-0.95 exact-fee edge floor: its fee was `$0.0046`, edge was `$0.0154`, and its exact official outcome yielded
`+$0.0654` proxy P&L. That is one supported date among 50 opportunity dates. The whole-date bootstrap retains the 49
zero-support dates; both one-sided 90% and 95% lower mean-P&L bounds are exactly `$0.0000` per opportunity date.

Promotion is not ready. The evidence has nonpositive conservative clustered support, only `1/50` supported dates versus
the frozen 30-date minimum, no historical displayed depth, zero provider-confirmed fills, and adaptive historical rather
than independent OOS status. Proxy P&L is diagnostic, not realized profit, and grants no recommendation, order,
capital-risk, trading, or production-activation authority.

The durable evaluator artifact has embedded SHA-256 `970bb65f6716bfb1ff7f2600bac02e44825b4cf90e76db6a7c4b99980ba7b9f8`.

## Reproduction

Use checksum-bound copies beneath `/var/tmp`:

```sh
deno task evaluate:v43-f066-plus-three-economics -- \
  --proxy /var/tmp/mimir-v43-f066-plus-three-execution-proxy.json \
  --outcomes /var/tmp/mimir-v43-outcomes.json \
  --output /var/tmp/mimir-v43-f066-plus-three-exact-fee-economics.json
```

The output is checksum-bound and create-once. The durable unchanged proxy and resulting economics artifact are in the
reviewed [`results/`](../evidence/v43-2026-01-07-2026-04-16/results/) namespace and covered by both nested and root
manifests.
