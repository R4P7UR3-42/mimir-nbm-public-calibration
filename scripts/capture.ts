const CAPTURE_SCHEMA = "noaa_nbm_native_max_t_q95_public_canary_v1";
const DECODE_SCHEMA = "noaa_nbm_native_max_t_q95_decode_v1";
const SOURCE_PRODUCT = "noaa_nbm_blend_qmd_12z_f042_native_max_t_q95_v1";
const INDEX_IDENTITY = "TMP:2 m above ground:24-42 hour max fcst:95% level";
const ECCODES_VERSION = "2.48.0";

interface Station {
  station_id: string;
  latitude: number;
  longitude: number;
}

interface Decoded {
  schema: string;
  eccodes_version: string;
  data_date: string;
  data_time: number;
  step_hours: number;
  step_range: string;
  percentile_value: number;
  short_name: string;
  level_type: string;
  level: number;
  grid_type: string;
  packing_type: string;
  values: Array<{
    station_id: string;
    grid_latitude: number;
    grid_longitude: number;
    distance_km: number;
    temperature_kelvin: number;
  }>;
}

if (import.meta.main) await main(Deno.args);

async function main(rawArgs: string[]) {
  const args = parseArgs(rawArgs);
  const outputDir = validateOutputDir(args.outputDir);
  const stations = JSON.parse(await Deno.readTextFile("data/stations.json")) as Station[];
  validateStations(stations);
  await Deno.mkdir(outputDir, { recursive: true });
  const runDate = shiftDate(args.marketDate, -1);
  const compactDate = runDate.replaceAll("-", "");
  const objectUrl =
    `https://noaa-nbm-grib2-pds.s3.amazonaws.com/blend.${compactDate}/12/qmd/blend.t12z.qmd.f042.co.grib2`;
  const indexUrl = `${objectUrl}.idx`;
  const budget = { used: 0, maximum: args.maxRequests };
  const indexResponse = await fetchOnce(indexUrl, budget);
  if (indexResponse.status !== 200) throw new Error(`index returned ${indexResponse.status}; expected 200`);
  const indexText = await indexResponse.text();
  const selected = parseIndex(indexText, runDate);
  const rangeResponse = await fetchOnce(objectUrl, budget, {
    headers: { range: `bytes=${selected.rangeStart}-${selected.rangeEnd}`, "user-agent": "NBM Q95 public canary" },
  });
  if (rangeResponse.status !== 206) throw new Error(`range returned ${rangeResponse.status}; expected 206`);
  const contentRange = rangeResponse.headers.get("content-range") ?? "";
  const contentMatch = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
  if (
    !contentMatch || Number(contentMatch[1]) !== selected.rangeStart ||
    Number(contentMatch[2]) !== selected.rangeEnd
  ) throw new Error("Content-Range does not match the exact index interval");
  const etag = rangeResponse.headers.get("etag") ?? "";
  const lastModified = new Date(rangeResponse.headers.get("last-modified") ?? "");
  const initialized = new Date(`${runDate}T12:00:00.000Z`);
  const deadline = new Date(`${runDate}T20:00:00.000Z`);
  if (!etag || Number.isNaN(lastModified.getTime()) || lastModified < initialized || lastModified > deadline) {
    throw new Error("object ETag or causal Last-Modified identity is invalid");
  }
  const bytes = new Uint8Array(await rangeResponse.arrayBuffer());
  if (
    bytes.length !== selected.messageLength || new TextDecoder().decode(bytes.slice(0, 4)) !== "GRIB" ||
    new TextDecoder().decode(bytes.slice(-4)) !== "7777"
  ) throw new Error("exact range is not one framed GRIB message");
  const gribPath = `${outputDir}/message.grib2`;
  const decodedPath = `${outputDir}/decoded.json`;
  await Deno.writeFile(gribPath, bytes, { createNew: true });
  const child = new Deno.Command("python3", {
    args: [
      "scripts/decode.py",
      "--grib",
      gribPath,
      "--stations",
      "data/stations.json",
      "--output",
      decodedPath,
      "--run-date",
      runDate,
    ],
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const result = await withTimeout(child.output(), () => child.kill("SIGKILL"), 60_000);
  if (!result.success) throw new Error(`decoder failed: ${new TextDecoder().decode(result.stderr).trim()}`);
  const decoded = JSON.parse(await Deno.readTextFile(decodedPath)) as Decoded;
  validateDecoded(decoded, runDate, stations);
  if (budget.used !== 2) throw new Error("canary did not consume exactly two requests");
  const evidence = {
    schema: CAPTURE_SCHEMA,
    generated_at: new Date().toISOString(),
    research_only: true,
    source_only: true,
    credential_required: false,
    private_data_access: false,
    provider_confirmed_fill_evidence: false,
    recommendation_authority: false,
    order_authority: false,
    capital_risk_authority: false,
    trading_authority: false,
    production_activation: false,
    active_trading_capability_changed: false,
    automatic_production_activation: false,
    source: {
      source_product: SOURCE_PRODUCT,
      market_date: args.marketDate,
      run_initialized_at: initialized.toISOString(),
      available_at: lastModified.toISOString(),
      object_url: objectUrl,
      index_url: indexUrl,
      index_identity: selected.identity,
      index_sha256: await sha256(new TextEncoder().encode(indexText)),
      range_start: selected.rangeStart,
      range_end: selected.rangeEnd,
      message_length: selected.messageLength,
      object_length: Number(contentMatch[3]),
      message_sha256: await sha256(bytes),
      etag,
      eccodes_version: decoded.eccodes_version,
      decoded_identity: selectDecodedIdentity(decoded),
      grid_type: decoded.grid_type,
      packing_type: decoded.packing_type,
    },
    request_policy: {
      maximum_requests: budget.maximum,
      actual_requests: budget.used,
      no_retry: true,
      terminal_http_429: true,
    },
    coverage: { stations: decoded.values.length, complete: true },
    rows: decoded.values.map((row) => ({
      station_id: row.station_id,
      grid_latitude: row.grid_latitude,
      grid_longitude: row.grid_longitude,
      distance_km: row.distance_km,
      q95_max_f: kelvinToFahrenheit(row.temperature_kelvin),
    })),
  };
  const evidencePath = `${outputDir}/evidence.json`;
  await Deno.writeTextFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { createNew: true });
  await Deno.writeTextFile(
    `${outputDir}/SHA256SUMS`,
    `${await sha256(await Deno.readFile(evidencePath))}  evidence.json\n`,
    {
      createNew: true,
    },
  );
  await Deno.remove(gribPath);
  await Deno.remove(decodedPath);
  console.log(JSON.stringify({ schema: evidence.schema, source: evidence.source, coverage: evidence.coverage }));
}

export function scheduledMarketDate(now: Date) {
  if (Number.isNaN(now.getTime())) throw new Error("scheduled clock is malformed");
  const runDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  runDate.setUTCDate(runDate.getUTCDate() + 1);
  return runDate.toISOString().slice(0, 10);
}

export function selectDecodedIdentity(decoded: Decoded) {
  return {
    data_date: decoded.data_date,
    data_time: decoded.data_time,
    step_hours: decoded.step_hours,
    step_range: decoded.step_range,
    percentile_value: decoded.percentile_value,
    short_name: decoded.short_name,
    level_type: decoded.level_type,
    level: decoded.level,
  };
}

export function parseIndex(text: string, runDate: string) {
  const lines = text.trim().split(/\r?\n/);
  const exactIdentity = `d=${runDate.replaceAll("-", "")}12:${INDEX_IDENTITY}`;
  const matches = lines.map((line, index) => ({ line, index })).filter(({ line }) =>
    line.split(":").slice(2).join(":") === exactIdentity
  );
  if (matches.length !== 1) throw new Error("index must contain exactly one exact target message");
  const selected = matches[0];
  const start = Number(selected.line.split(":")[1]);
  const nextStart = Number(lines[selected.index + 1]?.split(":")[1]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(nextStart) || nextStart <= start) {
    throw new Error("target index interval is terminal or malformed");
  }
  return {
    identity: selected.line,
    rangeStart: start,
    rangeEnd: nextStart - 1,
    messageLength: nextStart - start,
  };
}

function validateDecoded(decoded: Decoded, runDate: string, stations: Station[]) {
  if (
    decoded.schema !== DECODE_SCHEMA || decoded.eccodes_version !== ECCODES_VERSION ||
    decoded.data_date !== runDate.replaceAll("-", "") || decoded.data_time !== 1200 || decoded.step_hours !== 42 ||
    decoded.step_range !== "24-42" || decoded.percentile_value !== 95 || decoded.short_name !== "max_2t" ||
    decoded.level_type !== "heightAboveGround" || decoded.level !== 2 || !decoded.grid_type || !decoded.packing_type ||
    !Array.isArray(decoded.values) || decoded.values.length !== 20
  ) throw new Error("decoded GRIB identity is invalid");
  decoded.values.forEach((value, index) => {
    if (
      value.station_id !== stations[index].station_id || value.distance_km < 0 || value.distance_km > 5 ||
      ![value.grid_latitude, value.grid_longitude, value.distance_km, value.temperature_kelvin].every(Number.isFinite)
    ) throw new Error("decoded station identity is invalid");
  });
}

function validateStations(stations: Station[]) {
  if (
    stations.length !== 20 || new Set(stations.map((row) => row.station_id)).size !== 20 ||
    stations.some((row) =>
      !/^K[A-Z]{3}$/.test(row.station_id) || !Number.isFinite(row.latitude) ||
      !Number.isFinite(row.longitude)
    )
  ) throw new Error("frozen station inventory is invalid");
}

async function fetchOnce(url: string, budget: { used: number; maximum: number }, init?: RequestInit) {
  if (budget.used >= budget.maximum) throw new Error("request budget exhausted");
  budget.used += 1;
  const response = await fetch(url, init);
  if (response.status === 429) throw new Error("HTTP 429 is terminal; no retry is permitted");
  return response;
}

async function withTimeout<T>(operation: Promise<T>, kill: () => void, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      try {
        kill();
      } catch {
        // The process may have exited at the deadline.
      }
      reject(new Error("decoder exceeded 60 seconds"));
    }, milliseconds);
  });
  return await Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

function kelvinToFahrenheit(value: number) {
  if (!Number.isFinite(value) || value < 180 || value > 340) throw new Error("temperature is outside physical bounds");
  return ((value - 273.15) * 9 / 5 + 32).toString();
}

async function sha256(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("market date is malformed");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validateOutputDir(value: string) {
  const normalized = value.startsWith("/var/tmp/") ? value.replace(/\/+$/, "") : "";
  if (!normalized || normalized === "/var/tmp") throw new Error("output must be a child of /var/tmp");
  return normalized;
}

function parseArgs(raw: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < raw.length; index += 2) {
    if (!raw[index]?.startsWith("--") || raw[index + 1] === undefined) throw new Error("arguments are malformed");
    values.set(raw[index], raw[index + 1]);
  }
  const marketDate = values.get("--market-date") ?? "";
  const outputDir = values.get("--output-dir") ?? "";
  const maxRequests = Number(values.get("--max-requests"));
  if (!isIsoDate(marketDate) || !outputDir || maxRequests !== 2 || values.size !== 3) {
    throw new Error("exact market date, /var/tmp output, and --max-requests 2 are required");
  }
  return { marketDate, outputDir, maxRequests };
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
