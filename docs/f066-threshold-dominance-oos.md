# Frozen f066 Q95 threshold-dominance prospective source ledger

Identity: `noaa_nbm_native_max_t_q95_f066_threshold_dominance_oos_v1`

This order-free hypothesis begins with market date **2026-09-03**. It uses the two-day-prior 12Z NOAA NBM QMD native
Q95 daily-MaxT f066 message, whose `48-66` hour interval is exactly 12:00 UTC on the market date through 06:00 UTC on
the following date. The public source must be captured create-once before market-date quote evaluation. August 27,
August 31, and September 1 were development dates; September 2 is pre-start. None receives prospective, calibration,
outcome, execution, or profit credit.

The frozen offline evaluation rule is:

- exact high-temperature `above` contract, taking NO only;
- integer contract threshold greater than or equal to `ceil(f066 native Q95)` for the exact station and date;
- first fresh displayed NO ask in the prior-day `[14:00Z,18:00Z)` window, from `$0.70` through `$0.93`, with depth at
  least one;
- conservative probability lower score exactly `0.95`, exact quadratic taker fee, and net edge at least `$0.015`;
- one first qualifying row per station/date, then at most three station-distinct rows per date ranked by descending net
  edge and ticker.

The monotone event implication is the causal hypothesis: if the realized daily maximum is at most the frozen native
Q95 value, then every `above` threshold at or above its ceiling resolves NO. The value `0.95` is a model percentile,
not a calibrated probability or profit claim.

Keep f042 and f066 source, quote, selection, and outcome evidence in separate immutable namespaces. Stop for review at
30 independent market dates. A live cohort still requires a separate reviewed decision after causal future-only
evidence, whole-date clustered bounds, calibration/Brier checks, exact executable fees, provider-confirmed fill
evidence, concentration and drawdown limits, explicit capital authority, and every existing lifecycle gate. This ledger
has no recommendation, order, capital-risk, trading, or production-activation authority.
