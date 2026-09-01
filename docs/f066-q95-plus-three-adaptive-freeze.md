# Frozen f066 Q95 plus-three adaptive holdout and prospective hypothesis

Historical identity: `noaa_nbm_v43_f066_q95_floor_plus_3_adaptive_holdout_v1`

Prospective identity: `noaa_nbm_v5_f066_q95_floor_plus_3_prospective_v1`

This decision was frozen on 2026-09-01 after only the first two v4.3 source shards had been joined to outcomes. The
inspected development interval is `2026-01-07` through `2026-02-25`: 50 market dates, 20 frozen stations, and 1,000
station/dates. Exact official integer TMAX coverage was:

| f066 threshold | Wins | Coverage | Dates with at least one loss |
| --- | ---: | ---: | ---: |
| `floor(Q95)` | 842 / 1,000 | 84.2% | 46 / 50 |
| `floor(Q95)+1°F` | 909 / 1,000 | 90.9% | 38 / 50 |
| `floor(Q95)+2°F` | 948 / 1,000 | 94.8% | 30 / 50 |
| `floor(Q95)+3°F` | 978 / 1,000 | 97.8% | 16 / 50 |

The plus-three threshold is the smallest tested whole-degree buffer whose aggregate development coverage reached the
nominal 0.95 score. This is an adaptive, post-inspection choice. It is not independent OOS calibration, a calibrated
probability, execution evidence, a profit claim, or trading authority.

## Untouched v4.3 holdout

Only `2026-02-26` through `2026-04-16` may evaluate the historical identity: exactly 50 whole market-date clusters and
1,000 station/dates. Earlier dates receive development credit only. Evaluate the exact rule
`official integer TMAX <= floor(native f066 Q95)+3°F` with a fixed diagnostic score of 0.95. Report fixed-score Brier,
whole-date deterministic clustered 90% and 95% lower calibration margins, station concentration, date concentration,
and every station leave-one-out result. Do not pool f042, the raw f066 rule, development dates, current-v5 dates, or
station rows as extra independent dates. A failure falsifies the buffered family. A pass is still only adaptive
historical support and cannot authorize a recommendation or order.

## Separate current-v5 prospective ledger

The operational NBM changed from v4.3 to v5.0 in May 2026. The prospective identity therefore starts from zero and may
not inherit any v4.3 row or bound. Its first eligible market date is `2026-09-03`; earlier current-v5 rows are
development or pre-start and receive no credit. It reuses only the already frozen, order-free f066 source and immutable
prior-day quote/outcome snapshot producers. No producer, scheduler, policy, cohort, capital, or trading capability
changes are granted by this document.

For each exact station/date:

- use the checksum-bound two-day-prior 12Z native f066 Q95 source;
- select only an exact `above` contract at integer threshold `floor(Q95)+3°F`, taking NO;
- use the first fresh displayed NO ask in the prior-day `[14:00Z,18:00Z)` window with displayed depth at least one;
- record every exact ask through `$0.97`, but mark economics support only from `$0.70` through `$0.97` when the fixed
  0.95 diagnostic score, exact taker fee, and fee-adjusted edge are at least `$0.015`;
- select at most one row per station/date and at most three station-distinct rows per date, ranked by descending exact
  fee-adjusted edge and ticker; and
- use only the exact finalized Kalshi/NWS CLI-bound integer settlement outcome.

Exact threshold equality passes. `floor(Q95)+2°F`, adjacent strikes, missing exact strikes, stale or
later quotes, missing depth, wrong condition/side/source/settlement identity, and immediately lower fee-adjusted edge
fail. Stop for review after 30 independent prospective market dates. Evaluate whole dates, fixed reliability bands,
Brier skill versus displayed price, station/date concentration, drawdown, exact quote economics, and causal public-trade
support separately. Provider-confirmed fill evidence remains zero unless a later separately reviewed micro-live cohort
actually submits and fills.

The prospective ledger has no recommendation, order, capital-risk, trading, or production-activation authority. A
separate reviewed cohort decision still requires positive conservative net EV, exact executable depth, provider fills,
explicit capital authority, and all production lifecycle gates.
