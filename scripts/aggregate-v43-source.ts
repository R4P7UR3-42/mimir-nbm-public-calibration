import { sourceProfileIdentity, sourceRunDate, V43_HISTORICAL_MARKET_DATES } from "./capture.ts";

const AGGREGATE_SCHEMA = "noaa_nbm_v43_native_max_t_q95_adaptive_holdout_horizon_v1";
const SHA256 = /^[0-9a-f]{64}$/;
type HistoricalProfile = "v43-f042" | "v43-f066";

interface AggregateArgs {
  inputRoot: string;
  output: string;
  sourceProfile: HistoricalProfile;
}

if (import.meta.main) {
  try {
    const result = await aggregateV43HistoricalSource(parseArgs(Deno.args));
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    Deno.exit(1);
  }
}

export async function aggregateV43HistoricalSource(args: AggregateArgs) {
  const inputRoot = childOfVarTmp(args.inputRoot, "input root");
  const output = childOfVarTmp(args.output, "output");
  if (!output.endsWith(".json") || output === inputRoot) throw new Error("aggregate output path is unsafe");
  const profile = sourceProfileIdentity(args.sourceProfile);
  if (profile.historicalRegime === null) throw new Error("aggregate source profile is not historical");
  const stations = JSON.parse(await Deno.readTextFile("data/stations.json")) as Array<{ station_id: string }>;
  const stationIds = stations.map((row) => row.station_id);
  if (stationIds.length !== 20 || new Set(stationIds).size !== 20) {
    throw new Error("frozen station inventory is invalid");
  }

  const rows: Array<Record<string, string>> = [];
  const messageShas = new Set<string>();
  for (const marketDate of V43_HISTORICAL_MARKET_DATES) {
    const dateRoot = `${inputRoot}/${marketDate}`;
    const evidencePath = `${dateRoot}/evidence.json`;
    const checksumPath = `${dateRoot}/SHA256SUMS`;
    const evidenceBytes = await Deno.readFile(evidencePath);
    const checksum = (await Deno.readTextFile(checksumPath)).trim();
    const evidenceSha = await sha256(evidenceBytes);
    if (checksum !== `${evidenceSha}  evidence.json`) throw new Error(`evidence checksum failed for ${marketDate}`);
    const evidence = object(JSON.parse(new TextDecoder().decode(evidenceBytes)), "evidence");
    const source = object(evidence.source, "source");
    const requestPolicy = object(evidence.request_policy, "request policy");
    const coverage = object(evidence.coverage, "coverage");
    const expectedRunDate = sourceRunDate(marketDate, args.sourceProfile);
    const messageSha = text(source.message_sha256, "message SHA-256");
    if (
      evidence.schema !== profile.captureSchema || evidence.research_only !== true || evidence.source_only !== true ||
      evidence.historical_calibration_only !== true || evidence.source_regime !== profile.historicalRegime ||
      evidence.credential_required !== false || evidence.private_data_access !== false ||
      evidence.executable_quote_evidence !== false || evidence.outcome_evidence !== false ||
      evidence.provider_confirmed_fill_evidence !== false || evidence.recommendation_authority !== false ||
      evidence.order_authority !== false || evidence.capital_risk_authority !== false ||
      evidence.trading_authority !== false || evidence.production_activation !== false ||
      evidence.active_trading_capability_changed !== false || evidence.automatic_production_activation !== false ||
      source.source_profile !== args.sourceProfile || source.source_product !== profile.sourceProduct ||
      source.market_date !== marketDate || source.run_initialized_at !== `${expectedRunDate}T12:00:00.000Z` ||
      !SHA256.test(messageSha) || requestPolicy.maximum_requests !== 2 || requestPolicy.actual_requests !== 2 ||
      requestPolicy.no_retry !== true || requestPolicy.terminal_http_429 !== true || coverage.stations !== 20 ||
      coverage.complete !== true || !Array.isArray(evidence.rows) || evidence.rows.length !== 20
    ) throw new Error(`source identity or authority failed for ${marketDate}`);
    if (messageShas.has(messageSha)) throw new Error(`duplicate source message for ${marketDate}`);
    messageShas.add(messageSha);

    const dateRows = evidence.rows.map((value, index) => {
      const row = object(value, "source row");
      const q95 = text(row.q95_max_f, "Q95");
      if (
        row.station_id !== stationIds[index] || !Number.isFinite(Number(q95)) || Number(q95) < -100 ||
        Number(q95) > 160 || ![row.grid_latitude, row.grid_longitude, row.distance_km].every((item) =>
          typeof item === "number" && Number.isFinite(item)
        ) || Number(row.distance_km) < 0 || Number(row.distance_km) > 5
      ) {
        throw new Error(`station row failed for ${marketDate}`);
      }
      return {
        station_id: stationIds[index],
        market_date: marketDate,
        q95_max_f: q95,
        source_profile: args.sourceProfile,
        source_product: profile.sourceProduct,
        source_run_date: expectedRunDate,
        message_sha256: messageSha,
      };
    });
    rows.push(...dateRows);
  }
  if (
    messageShas.size !== 100 || rows.length !== 2_000 ||
    new Set(rows.map((row) => `${row.station_id}:${row.market_date}`)).size !== 2_000
  ) {
    throw new Error("aggregate station/date coverage is incomplete");
  }

  const horizon = args.sourceProfile === "v43-f042" ? "f042" : "f066";
  const payload = {
    schema: AGGREGATE_SCHEMA,
    horizon,
    source_profile: args.sourceProfile,
    source_product: profile.sourceProduct,
    evidence_class: "adaptive_historical_holdout",
    independent_oos: false,
    research_only: true,
    recommendation_authority: false,
    order_authority: false,
    capital_risk_authority: false,
    trading_authority: false,
    production_activation: false,
    date_window: { start: "2026-01-07", end: "2026-04-16", independent_market_dates: 100 },
    coverage: { stations: 20, market_dates: 100, station_dates: 2_000, complete: true },
    rows,
  } as const;
  const artifact = { artifact_sha256: await sha256(new TextEncoder().encode(JSON.stringify(payload))), ...payload };
  await Deno.writeTextFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { createNew: true });
  return { ok: true, output, artifact_sha256: artifact.artifact_sha256, horizon, rows: rows.length };
}

function parseArgs(raw: string[]): AggregateArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < raw.length; index += 2) {
    if (!raw[index]?.startsWith("--") || raw[index + 1] === undefined) throw new Error("arguments are malformed");
    values.set(raw[index], raw[index + 1]);
  }
  const sourceProfile = values.get("--source-profile");
  if (
    values.size !== 3 || !values.get("--input-root") || !values.get("--output") ||
    (sourceProfile !== "v43-f042" && sourceProfile !== "v43-f066")
  ) throw new Error("aggregate requires one exact historical source profile, input root, and output");
  return {
    inputRoot: values.get("--input-root")!,
    output: values.get("--output")!,
    sourceProfile,
  };
}

function childOfVarTmp(value: string, label: string) {
  const normalized = value.startsWith("/var/tmp/") ? value.replace(/\/+$/, "") : "";
  if (!normalized || normalized === "/var/tmp") throw new Error(`${label} must be a child of /var/tmp`);
  return normalized;
}

function object(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`${label} is malformed`);
  return value;
}

async function sha256(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
