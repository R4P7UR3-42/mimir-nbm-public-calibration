# 2026-09-01 historical execution-proxy rate incident

The first real buffered-f066 historical execution-proxy invocation stopped at a terminal HTTP 429 while reading
`/historical/markets`. The invocation made no retry and produced no output artifact. The client had limited ordinary
request starts to five per second, nominally within the documented Basic token-bucket rate, while candlestick starts
were already limited to one per second. Public historical traffic nevertheless demonstrated a lower effective boundary;
the API response exposes no rate-limit headers from which the client could safely derive a faster public cadence.

The bounded correction lowers every request start to at most one per second. It does not retry the failed invocation,
change the 8,401-request ceiling, add adaptive backoff, treat a 429 as recoverable, or alter any source, selection,
economics, evidence, fill, recommendation, order, capital, trading, or production authority. A terminal error now names
the attempted request ordinal and exact public path without adding the failed request to the successful capture list.

Only a new invocation with no pre-existing output may use the corrected cadence. Another 429 remains terminal and must
produce no artifact; it is evidence to reassess the provider boundary before any further fresh run.
