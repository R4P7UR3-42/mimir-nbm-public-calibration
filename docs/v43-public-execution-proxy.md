# Frozen v4.3 public execution-proxy export

The credential-free execution-proxy exporter measures whether the already checksum-bound v4.3 native-Q95 family had
causal public price and trade support. It does not recover historical order-book depth, prove that a Mimir order would
have filled, claim profit, or grant recommendation, order, capital, trading, or production authority.

## Frozen selection

The exporter accepts exactly one `v43-f042` 2,000-row horizon artifact plus the checksum-bound evaluator artifact that
names its SHA-256. It validates all 20 station/series/product identities and the exact 100-date `2026-01-07` through
`2026-04-16` window before networking. A zero-network calibration preflight then requires the selected horizon's
`complete_100_dates` and `nonnegative_clustered_90_margin` gates to both be true. Failure stops before the Kalshi cutoff
request: public execution reads cannot rescue a Q95 family that has already failed its chosen whole-date calibration
boundary. The 90% clustered gate is the minimum bounded falsification screen for this adaptive holdout; it is not
independent OOS evidence, a profitability claim, or permission to trade. For each station/date that passes, the exporter
freezes:

- the exact daily high-temperature series and event ticker;
- a `greater` contract whose `floor_strike` is `floor(native Q95 °F)`;
- the NO side, corresponding to official integer `TMAX <= floor(Q95)`;
- prior-market-date `20:05:00Z` as the causal decision time; and
- the exact HTTPS NWS CLI settlement URL, office, `issuedby` product, and observation station.

The earlier raw `v43-f066` evaluation remains rejected before the first Kalshi request. It cannot inherit f042's
`floor(Q95)` strike or `20:05Z` clock, and it cannot be relabeled as the later buffered policy.

The separately frozen `noaa_nbm_v43_f066_q95_floor_plus_3_adaptive_holdout_v1` identity is supported only as a bounded
price/trade-availability proxy after every one of its 50-date holdout gates passes. The exporter admits exactly the
untouched `2026-02-26` through `2026-04-16` rows, selects only the exact `greater` strike `floor(native f066 Q95)+3°F`,
and reads one-minute candles and public trades strictly inside the prior-day `[14:00Z,18:00Z)` window. The inspected
first 50 dates, f042 rows, raw f066 policy, current-v5 prospective rows, adjacent strikes, and adjacent clock boundaries
receive no credit.

For the buffered f066 policy, the first complete in-window candle carrying a YES-bid close supplies a NO-ask price
proxy. It can measure whether the exact strike commonly showed a price in the frozen `$0.70`–`$0.97` band and whether
compatible public prints followed. It cannot prove the prospective first _depth-qualified_ quote: candles omit displayed
quantity and compress the minute, so within-minute quote ordering and the depth-at-least-one condition are
unrecoverable. Every f066 row therefore records `displayed_depth=null` and
`exact_prospective_selection_reconstructed=false`; the artifact reports no exact net-EV selection, executable depth,
member fill, or trading authority. Current-v5 causal prospective snapshots remain necessary.

The market payload's final quote, result, and volume cannot influence selection. A missing exact strike, missing NWS
identity, duplicate identity, or market that was not open at the frozen decision remains an explicit unsupported row. It
is never replaced by an adjacent strike.

## Evidence classes

Kalshi's [historical-data contract](https://docs.kalshi.com/getting_started/historical_data) partitions settled markets,
candlesticks, and public trades at the timestamps returned by `GET /historical/cutoff`. The exporter requires both the
market and trade cutoffs to cover the complete frozen window, enumerates `GET /historical/markets` by each exact series,
and joins old events from `GET /events?status=settled` by exact event ticker. Historical market discovery is
cursor-paginated at 1,000 markets per page; settled-event discovery uses 200 events per page. Both stop after ten pages
per series and reject repeated or malformed cursors.

For each selected contract, `GET /historical/markets/{ticker}/candlesticks` requests one-minute candles from five
minutes before the decision through the decision timestamp. Per Kalshi's
[historical candlestick reference](https://docs.kalshi.com/api-reference/historical/get-historical-market-candlesticks),
`end_period_ts` identifies the period end and the query includes candles ending on or after `start_ts` and on or before
`end_ts`. The exporter rejects duplicate/future period ends and selects only the last complete candle at or before the
decision. `yes_bid.close` and `yes_ask.close` are historical one-minute top-of-book OHLC values. The prospective NO ask
proxy is exactly `1.0000 - yes_bid.close`, following Kalshi's
[binary order-book equivalence](https://docs.kalshi.com/getting_started/orderbook_responses). Candlesticks expose no
displayed quantity, order identity, queue position, or full depth, so the artifact always records `displayed_depth=null`
and labels the value `one_minute_top_of_book_proxy_without_depth`.

`GET /historical/trades` then reads the exact ticker over `[decision, decision + 5 minutes)`. The
[historical trade response](https://docs.kalshi.com/api-reference/historical/get-historical-trades) exposes a public
trade ID, timestamp, fixed-point quantity, complementary YES/NO prices, and taker side. It does not identify historical
resting depth, queue priority, whether liquidity remained after the print, or whether the member running this research
filled. A compatible print is therefore an execution-plausibility proxy only. The exporter never calls authenticated
`/historical/fills`, and provider-confirmed fills remain exactly zero.

## Request and storage boundary

The absolute request ceiling is derived before execution:

| Request class                              |   Maximum |
| ------------------------------------------ | --------: |
| Historical cutoff                          |         1 |
| Historical markets: 20 series × 10 pages   |       200 |
| Events: 20 series × 10 pages               |       200 |
| One candlestick request per station/date   |     2,000 |
| Historical trades: 2,000 tickers × 3 pages |     6,000 |
| **Total**                                  | **8,401** |

The client sends no Kalshi authentication headers, never retries, treats HTTP 429 as terminal, limits all reads to five
per second, and limits candlestick starts to one per second. Every provider page, candle response, selected raw market,
selected raw event, and public trade receives a SHA-256 identity. Input and output paths must be children of `/var/tmp`,
and the JSON output is create-once. No database is opened.

Run only after the complete source and evaluator artifacts exist:

```sh
deno task export:v43-execution-proxy -- \
  --source /var/tmp/nbm-v43-f042-horizon.json \
  --evaluation /var/tmp/nbm-v43-evaluation.json \
  --output /var/tmp/nbm-v43-f042-execution-proxy.json \
  --max-requests 8401
```

For the exact buffered f066 identity, substitute the checksum-bound `v43-f066` horizon and its exact plus-three
evaluation artifact. The same command then emits 1,000 holdout rows under the strict four-hour proxy window. Raw f066,
adjacent buffered identities, and development/current-v5 rows still fail before networking. Do not reinterpret a
quote/trade proxy as exact depth-qualified selection, exact fee-adjusted EV, a member fill, realized P&L, independent
OOS evidence, or permission to trade.
