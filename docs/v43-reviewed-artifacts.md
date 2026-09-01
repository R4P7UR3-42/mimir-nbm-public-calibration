# Durable reviewed NBM v4.3 evidence

The complete reviewed source, outcome, and evaluation tree for the frozen `2026-01-07` through `2026-04-16` NBM v4.3
study is committed unchanged at [`evidence/v43-2026-01-07-2026-04-16/`](../evidence/v43-2026-01-07-2026-04-16/). This
public repository path, not its former `/var/tmp` assembly directory or expiring Actions artifacts, is the durable
evidence authority.

The root manifest is `SHA256SUMS.root`, whose current file SHA-256 is
`32cf1f5ca82e747fdb36c75e743f792f0b4aed9535bb535c551a7d5d1e5986bb`. Run the following from the evidence directory to
verify every path without rewriting anything:

```sh
sha256sum -c SHA256SUMS.root
```

The tree contains 826 files including the root manifest (825 paths covered by that manifest). Every original source,
outcome, run, and evaluation payload remains byte-identical; two reviewed results were appended under `results/`, and
the results and root manifests were updated to cover them. Its four credential-free source workflow runs are:

- [shard 1, run 33473803900](https://github.com/R4P7UR3-42/mimir-nbm-public-calibration/actions/runs/33473803900)
- [shard 2, run 33474675348](https://github.com/R4P7UR3-42/mimir-nbm-public-calibration/actions/runs/33474675348)
- [shard 3, run 33475451115](https://github.com/R4P7UR3-42/mimir-nbm-public-calibration/actions/runs/33475451115)
- [shard 4, run 33476247254](https://github.com/R4P7UR3-42/mimir-nbm-public-calibration/actions/runs/33476247254)

The durable tree includes both disjoint horizon aggregates, the exact official-outcome artifact, the raw two-horizon
evaluation, the buffered f066 50-date holdout evaluation, the unchanged public execution-proxy artifact, and its
deterministic [exact-fee economics result](v43-f066-plus-three-exact-fee-economics.md). Their authority flags and
limitations remain unchanged: they are adaptive historical research, not independent OOS, live execution, member-fill,
realized-profit, capital-risk, recommendation, order, trading, or production-activation evidence.
