# NOAA NBM native MaxT Q95 public calibration

Credential-free, order-free source-feasibility capture for one exact NOAA NBM QMD field:

`TMP:2 m above ground:24-42 hour max fcst:95% level`

The canary reads the prior-day 12Z f042 public object for one market date, makes exactly two HTTP requests (index plus
one byte range), decodes the frozen 20-station inventory with pinned ecCodes, and publishes checksum-bound evidence.

This repository contains no Kalshi client, credentials, private data, production access, recommendation logic, order
logic, capital authority, or trading authority. A successful canary establishes source feasibility only.

Run locally only in an isolated environment:

```sh
deno run --allow-read=. --allow-write=/var/tmp --allow-run=python3 \
  --allow-net=noaa-nbm-grib2-pds.s3.amazonaws.com:443 scripts/capture.ts \
  --market-date 2026-09-01 --output-dir /var/tmp/nbm-q95-canary --max-requests 2
```
