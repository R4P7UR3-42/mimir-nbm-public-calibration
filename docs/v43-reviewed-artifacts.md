# Durable reviewed NBM v4.3 evidence

The complete reviewed source, outcome, and evaluation tree for the frozen `2026-01-07` through `2026-04-16` NBM v4.3
study is committed unchanged at [`evidence/v43-2026-01-07-2026-04-16/`](../evidence/v43-2026-01-07-2026-04-16/). This
public repository path, not its former `/var/tmp` assembly directory or expiring Actions artifacts, is the durable
evidence authority.

The root manifest is `SHA256SUMS.root`, whose file SHA-256 is
`aa4930962de6bef7ac124b42b8617d2aced9757f6dea9de6daed34175cfdf1d1`. Run the following from the evidence directory to
verify every path without rewriting anything:

```sh
sha256sum -c SHA256SUMS.root
```

The tree contains 824 files including the root manifest (823 paths covered by that manifest) and preserves the original
relative paths. Its four credential-free source workflow runs are:

- [shard 1, run 33473803900](https://github.com/R4P7UR3-42/mimir-nbm-public-calibration/actions/runs/33473803900)
- [shard 2, run 33474675348](https://github.com/R4P7UR3-42/mimir-nbm-public-calibration/actions/runs/33474675348)
- [shard 3, run 33475451115](https://github.com/R4P7UR3-42/mimir-nbm-public-calibration/actions/runs/33475451115)
- [shard 4, run 33476247254](https://github.com/R4P7UR3-42/mimir-nbm-public-calibration/actions/runs/33476247254)

The durable tree includes both disjoint horizon aggregates, the exact official-outcome artifact, the raw two-horizon
evaluation, and the buffered f066 50-date holdout evaluation. Their authority flags and limitations remain unchanged:
they are adaptive historical research, not independent OOS, live execution, member-fill, realized-profit, capital-risk,
recommendation, order, trading, or production-activation evidence.
