const START_DATE = "2026-01-07";
const END_DATE = "2026-04-16";
const OUTCOME_SCHEMA = "noaa_nbm_v43_q95_adaptive_holdout_outcomes_v1";
const CATALOG_URL = "https://www.ncei.noaa.gov/pub/data/noaa/isd-history.csv";
const OUTCOME_URL = "https://www.ncei.noaa.gov/access/services/data/v1";
const STATION_IDS = [
  "KOKC",
  "KHOU",
  "KSAT",
  "KNYC",
  "KBOS",
  "KPHL",
  "KDCA",
  "KMDW",
  "KATL",
  "KAUS",
  "KMIA",
  "KDFW",
  "KDEN",
  "KLAX",
  "KSFO",
  "KSEA",
  "KPHX",
  "KLAS",
  "KMSP",
  "KMSY",
] as const;

export interface FrozenStation {
  station_id: string;
  latitude: number;
  longitude: number;
}

export interface OutcomeRow {
  station_id: string;
  market_date: string;
  ghcn_station_id: string;
  tmax_f: number;
}

interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface AcquireOutcomeOptions {
  stations: FrozenStation[];
  fetchImpl?: FetchLike;
  generatedAt?: Date;
}

export const V43_OUTCOME_START = START_DATE;
export const V43_OUTCOME_END = END_DATE;
export const V43_OUTCOME_SCHEMA = OUTCOME_SCHEMA;
export const V43_STATION_IDS = STATION_IDS;

if (import.meta.main) await main(Deno.args);

export async function acquireV43OfficialOutcomes(options: AcquireOutcomeOptions) {
  validateStations(options.stations);
  const fetchImpl = options.fetchImpl ?? fetch;
  let requests = 0;
  const fetchOnce = async (url: string) => {
    if (requests >= 2) throw new Error("v4.3 outcome request budget exhausted");
    requests += 1;
    const response = await fetchImpl(url, { headers: { "user-agent": "Mimir NBM v4.3 holdout" } });
    if (response.status === 429) throw new Error("v4.3 outcome source returned terminal HTTP 429");
    if (response.status !== 200) throw new Error(`v4.3 outcome source returned ${response.status}; no retry permitted`);
    return response;
  };

  const catalogResponse = await fetchOnce(CATALOG_URL);
  const mappings = parseIsdCatalog(await catalogResponse.text(), options.stations);
  const ghcnIds = options.stations.map((station) => mappings.get(station.station_id)!.ghcnStationId);
  const query = new URLSearchParams({
    dataset: "daily-summaries",
    stations: ghcnIds.join(","),
    startDate: START_DATE,
    endDate: END_DATE,
    format: "json",
    units: "standard",
    includeAttributes: "false",
    includeStationName: "true",
    includeStationLocation: "true",
  });
  const outcomeResponse = await fetchOnce(`${OUTCOME_URL}?${query}`);
  const rows = normalizeDailySummaries(await outcomeResponse.json(), options.stations, mappings);
  if (requests !== 2) throw new Error("v4.3 outcome acquisition must make exactly two requests");
  const generatedAt = options.generatedAt ?? new Date();
  if (Number.isNaN(generatedAt.getTime())) throw new Error("v4.3 outcome generation clock is malformed");
  const unsigned = {
    schema: OUTCOME_SCHEMA,
    generated_at: generatedAt.toISOString(),
    evidence_class: "adaptive_historical_holdout",
    independent_oos: false,
    profit_evidence: false,
    research_only: true,
    recommendation_authority: false,
    order_authority: false,
    capital_risk_authority: false,
    trading_authority: false,
    production_activation: false,
    date_window: { start: START_DATE, end: END_DATE, independent_market_dates: 100 },
    source: {
      catalog_url: CATALOG_URL,
      outcome_url: OUTCOME_URL,
      dataset: "daily-summaries",
      field: "TMAX",
      units: "standard",
      mapping: "exact_icao_to_isd_usaf_wban_to_ghcnd_usw000_wban_v1",
    },
    request_policy: { maximum_requests: 2, actual_requests: requests, no_retry: true, terminal_http_429: true },
    coverage: { stations: 20, market_dates: 100, station_dates: 2_000, complete: true },
    rows,
  };
  return { artifact_sha256: await canonicalSha256(unsigned), ...unsigned };
}

export async function writeOutcomeArtifactCreateOnce(path: string, artifact: unknown) {
  const value = object(artifact, "outcome artifact");
  const expected = String(value.artifact_sha256 ?? "");
  const { artifact_sha256: _discard, ...unsigned } = value;
  if (
    !/^[a-f0-9]{64}$/.test(expected) || await canonicalSha256(unsigned) !== expected ||
    value.schema !== OUTCOME_SCHEMA || value.evidence_class !== "adaptive_historical_holdout" ||
    value.independent_oos !== false || value.research_only !== true || value.recommendation_authority !== false ||
    value.order_authority !== false || value.capital_risk_authority !== false || value.trading_authority !== false ||
    value.production_activation !== false
  ) throw new Error("outcome artifact checksum, identity, or authority is invalid");
  const bytes = new TextEncoder().encode(`${JSON.stringify(artifact, null, 2)}\n`);
  await Deno.writeFile(path, bytes, { createNew: true });
  return await sha256(bytes);
}

export function parseIsdCatalog(text: string, stations: FrozenStation[]) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("ISD catalog is empty");
  const headers = csvLine(lines[0]);
  const required = ["USAF", "WBAN", "ICAO", "LAT", "LON", "BEGIN", "END"];
  const indexes = Object.fromEntries(required.map((name) => [name, headers.indexOf(name)]));
  if (required.some((name) => indexes[name] < 0)) throw new Error("ISD catalog headers are incomplete");
  const wanted = new Map(stations.map((station) => [station.station_id, station]));
  const result = new Map<string, { ghcnStationId: string; usaf: string; wban: string }>();
  for (const line of lines.slice(1)) {
    const values = csvLine(line);
    const icao = values[indexes.ICAO]?.trim();
    const station = wanted.get(icao);
    if (!station) continue;
    const usaf = values[indexes.USAF]?.trim();
    const wban = values[indexes.WBAN]?.trim();
    const latitude = Number(values[indexes.LAT]);
    const longitude = Number(values[indexes.LON]);
    const begin = values[indexes.BEGIN]?.trim();
    const end = values[indexes.END]?.trim();
    if (begin > START_DATE.replaceAll("-", "") || end < END_DATE.replaceAll("-", "")) continue;
    if (
      !/^\d{6}$/.test(usaf) || !/^\d{5}$/.test(wban) || wban === "99999" ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude - station.latitude) > 0.2 || Math.abs(longitude - station.longitude) > 0.2
    ) throw new Error(`ISD catalog identity is invalid for ${icao}`);
    if (result.has(icao)) throw new Error(`ISD catalog identity is ambiguous for ${icao}`);
    result.set(icao, { ghcnStationId: `USW000${wban}`, usaf, wban });
  }
  if (result.size !== 20) throw new Error("ISD catalog does not map every frozen station exactly once");
  return result;
}

export function normalizeDailySummaries(
  value: unknown,
  stations: FrozenStation[],
  mappings: Map<string, { ghcnStationId: string }>,
): OutcomeRow[] {
  if (!Array.isArray(value)) throw new Error("NCEI Daily Summaries payload is malformed");
  const stationByGhcn = new Map(
    stations.map((station) => [mappings.get(station.station_id)!.ghcnStationId, station]),
  );
  const expectedDates = frozenDates();
  const seen = new Set<string>();
  const rows: OutcomeRow[] = [];
  for (const raw of value) {
    const row = object(raw, "NCEI outcome row");
    const ghcn = String(row.STATION ?? "");
    const station = stationByGhcn.get(ghcn);
    const marketDate = String(row.DATE ?? "");
    const tmax = Number(row.TMAX);
    if (!station || !expectedDates.has(marketDate) || !Number.isInteger(tmax) || tmax < -100 || tmax > 150) {
      throw new Error("NCEI outcome station, date, or integer TMAX is invalid");
    }
    if (row.LATITUDE !== undefined && Math.abs(Number(row.LATITUDE) - station.latitude) > 0.2) {
      throw new Error("NCEI outcome latitude conflicts with the frozen station");
    }
    if (row.LONGITUDE !== undefined && Math.abs(Number(row.LONGITUDE) - station.longitude) > 0.2) {
      throw new Error("NCEI outcome longitude conflicts with the frozen station");
    }
    const key = `${station.station_id}/${marketDate}`;
    if (seen.has(key)) throw new Error("NCEI outcome contains a duplicate station/date");
    seen.add(key);
    rows.push({ station_id: station.station_id, market_date: marketDate, ghcn_station_id: ghcn, tmax_f: tmax });
  }
  if (seen.size !== 2_000) throw new Error("NCEI outcome coverage is incomplete");
  return rows.sort((a, b) => a.market_date.localeCompare(b.market_date) || a.station_id.localeCompare(b.station_id));
}

export function frozenDates() {
  const dates = new Set<string>();
  for (let value = START_DATE; value <= END_DATE; value = shiftDate(value, 1)) dates.add(value);
  if (dates.size !== 100) throw new Error("frozen v4.3 outcome window is not exactly 100 dates");
  return dates;
}

function validateStations(stations: FrozenStation[]) {
  const actual = stations.map((station) => station.station_id).sort();
  const expected = [...STATION_IDS].sort();
  if (
    stations.length !== 20 || new Set(stations.map((station) => station.station_id)).size !== 20 ||
    JSON.stringify(actual) !== JSON.stringify(expected) ||
    stations.some((station) =>
      !/^K[A-Z0-9]{3}$/.test(station.station_id) ||
      !Number.isFinite(station.latitude) || !Number.isFinite(station.longitude)
    )
  ) throw new Error("frozen station identity is incomplete");
}

function csvLine(line: string) {
  const values: string[] = [];
  let value = "", quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') value += line[index++];
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) values.push(value), value = "";
    else value += character;
  }
  if (quoted) throw new Error("ISD catalog CSV is malformed");
  values.push(value);
  return values;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("date is malformed");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function object(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed`);
  return value as Record<string, unknown>;
}

async function canonicalSha256(value: unknown) {
  return await sha256(new TextEncoder().encode(JSON.stringify(value)));
}

async function sha256(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function main(raw: string[]) {
  const args = parseArgs(raw);
  if (args.size !== 2) throw new Error("v4.3 outcome arguments are malformed");
  const stationPath = args.get("--stations") ?? "";
  const outputPath = args.get("--output") ?? "";
  if (!stationPath || !outputPath) throw new Error("v4.3 outcome arguments are incomplete");
  const stations = JSON.parse(await Deno.readTextFile(stationPath)) as FrozenStation[];
  const artifact = await acquireV43OfficialOutcomes({ stations });
  await writeOutcomeArtifactCreateOnce(outputPath, artifact);
  console.log(JSON.stringify({ schema: artifact.schema, artifact_sha256: artifact.artifact_sha256 }));
}

function parseArgs(raw: string[]) {
  const args = new Map<string, string>();
  for (let index = 0; index < raw.length; index += 2) {
    const key = raw[index], value = raw[index + 1];
    if (!key?.startsWith("--") || value === undefined || args.has(key)) throw new Error("arguments are malformed");
    args.set(key, value);
  }
  return args;
}
