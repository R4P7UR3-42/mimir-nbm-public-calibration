const SOURCE_REPOSITORY = "R4P7UR3-42/mimir-nbm-public-calibration";
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;

type SourceProfileName = "f042" | "f066";

const SOURCE_PROFILES = {
  f042: {
    durableSchema: "noaa_nbm_q95_public_durable_provenance_v1",
    evidenceSchema: "noaa_nbm_native_max_t_q95_public_canary_v1",
    workflowPath: ".github/workflows/one-date-canary.yml",
    namespace: "evidence",
  },
  f066: {
    durableSchema: "noaa_nbm_q95_f066_public_durable_provenance_v1",
    evidenceSchema: "noaa_nbm_native_max_t_q95_f066_public_canary_v1",
    workflowPath: ".github/workflows/f066-daily-source.yml",
    namespace: "evidence-f066",
  },
} as const;

interface PreserveInput {
  root: string;
  marketDate: string;
  sourceDir: string;
  workflowSourceSha: string;
  workflowRunId: string;
  workflowRunAttempt: number;
  sourceProfile?: SourceProfileName;
}

if (import.meta.main) await main(Deno.args);

export async function inspectDurableEvidence(
  root: string,
  marketDate: string,
  sourceProfile: SourceProfileName = "f042",
) {
  const path = durablePath(root, marketDate, sourceProfile);
  try {
    const stat = await Deno.lstat(path);
    if (!stat.isDirectory || stat.isSymlink) throw new Error("durable evidence path is not a regular directory");
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "missing" as const;
    throw error;
  }
  const entries = [];
  for await (const entry of Deno.readDir(path)) entries.push(entry);
  const expected = ["SHA256SUMS", "evidence.json", "provenance.json"];
  if (
    entries.some((entry) => !entry.isFile || entry.isSymlink) ||
    JSON.stringify(entries.map((entry) => entry.name).sort()) !== JSON.stringify(expected)
  ) throw new Error("durable evidence directory is incomplete or contains drift");

  const evidenceBytes = await Deno.readFile(`${path}/evidence.json`);
  const provenanceBytes = await Deno.readFile(`${path}/provenance.json`);
  const evidenceSha = await sha256(evidenceBytes);
  const provenanceSha = await sha256(provenanceBytes);
  const expectedSums = `${evidenceSha}  evidence.json\n${provenanceSha}  provenance.json\n`;
  if (await Deno.readTextFile(`${path}/SHA256SUMS`) !== expectedSums) {
    throw new Error("durable evidence checksum manifest does not reproduce");
  }
  validateEvidence(JSON.parse(new TextDecoder().decode(evidenceBytes)), marketDate, sourceProfile);
  validateProvenance(JSON.parse(new TextDecoder().decode(provenanceBytes)), marketDate, evidenceSha, sourceProfile);
  return "existing" as const;
}

export async function preserveEvidence(input: PreserveInput) {
  const sourceProfile = input.sourceProfile ?? "f042";
  const profile = SOURCE_PROFILES[sourceProfile];
  if (await inspectDurableEvidence(input.root, input.marketDate, sourceProfile) === "existing") {
    throw new Error("durable evidence already exists and cannot be overwritten");
  }
  if (
    !GIT_SHA.test(input.workflowSourceSha) || !/^\d+$/.test(input.workflowRunId) ||
    !Number.isInteger(input.workflowRunAttempt) || input.workflowRunAttempt < 1
  ) {
    throw new Error("workflow provenance identity is malformed");
  }
  const sourceEvidence = await Deno.readFile(`${input.sourceDir}/evidence.json`);
  const evidenceSha = await sha256(sourceEvidence);
  if (await Deno.readTextFile(`${input.sourceDir}/SHA256SUMS`) !== `${evidenceSha}  evidence.json\n`) {
    throw new Error("source evidence checksum does not reproduce");
  }
  validateEvidence(JSON.parse(new TextDecoder().decode(sourceEvidence)), input.marketDate, sourceProfile);

  const relativePath = `${profile.namespace}/${input.marketDate}`;
  const provenance = {
    schema: profile.durableSchema,
    source_repository: SOURCE_REPOSITORY,
    workflow_path: profile.workflowPath,
    workflow_source_sha: input.workflowSourceSha,
    workflow_run_id: input.workflowRunId,
    workflow_run_attempt: input.workflowRunAttempt,
    market_date: input.marketDate,
    evidence_sha256: evidenceSha,
    create_once_commit_path: relativePath,
    research_only: true,
    source_only: true,
    credential_required: false,
    provider_confirmed_fill_evidence: false,
    recommendation_authority: false,
    order_authority: false,
    capital_risk_authority: false,
    trading_authority: false,
    production_activation: false,
    active_trading_capability_changed: false,
    automatic_production_activation: false,
  };
  const provenanceBytes = new TextEncoder().encode(`${JSON.stringify(provenance, null, 2)}\n`);
  const provenanceSha = await sha256(provenanceBytes);
  const evidenceRoot = `${input.root.replace(/\/+$/, "")}/${profile.namespace}`;
  await Deno.mkdir(evidenceRoot, { recursive: true });
  const staging = await Deno.makeTempDir({ dir: evidenceRoot, prefix: `.${input.marketDate}-` });
  try {
    await Deno.writeFile(`${staging}/evidence.json`, sourceEvidence, { createNew: true });
    await Deno.writeFile(`${staging}/provenance.json`, provenanceBytes, { createNew: true });
    await Deno.writeTextFile(
      `${staging}/SHA256SUMS`,
      `${evidenceSha}  evidence.json\n${provenanceSha}  provenance.json\n`,
      { createNew: true },
    );
    await Deno.rename(staging, durablePath(input.root, input.marketDate, sourceProfile));
  } catch (error) {
    await Deno.remove(staging, { recursive: true }).catch(() => undefined);
    throw error;
  }
  if (await inspectDurableEvidence(input.root, input.marketDate, sourceProfile) !== "existing") {
    throw new Error("durable evidence preservation did not verify");
  }
  return relativePath;
}

function validateEvidence(value: unknown, marketDate: string, sourceProfile: SourceProfileName) {
  const profile = SOURCE_PROFILES[sourceProfile];
  const evidence = object(value, "evidence");
  const source = object(evidence.source, "evidence source");
  const requests = object(evidence.request_policy, "request policy");
  const coverage = object(evidence.coverage, "coverage");
  const f066IdentityIsValid = sourceProfile !== "f066" ||
    (source.source_profile === "f066" &&
      source.source_product === "noaa_nbm_blend_qmd_12z_f066_native_max_t_q95_v1" &&
      source.valid_interval_start === `${marketDate}T12:00:00.000Z` &&
      source.valid_interval_end === `${shiftDate(marketDate, 1)}T06:00:00.000Z`);
  if (
    evidence.schema !== profile.evidenceSchema || evidence.research_only !== true ||
    evidence.source_only !== true || evidence.credential_required !== false || evidence.private_data_access !== false ||
    evidence.provider_confirmed_fill_evidence !== false || evidence.recommendation_authority !== false ||
    evidence.order_authority !== false || evidence.capital_risk_authority !== false ||
    evidence.trading_authority !== false || evidence.production_activation !== false ||
    evidence.active_trading_capability_changed !== false || evidence.automatic_production_activation !== false ||
    source.market_date !== marketDate || requests.maximum_requests !== 2 || requests.actual_requests !== 2 ||
    requests.no_retry !== true || requests.terminal_http_429 !== true || coverage.stations !== 20 ||
    coverage.complete !== true || !Array.isArray(evidence.rows) || evidence.rows.length !== 20 || !f066IdentityIsValid
  ) throw new Error("evidence authority, identity, request budget, or coverage is invalid");
}

function validateProvenance(
  value: unknown,
  marketDate: string,
  evidenceSha: string,
  sourceProfile: SourceProfileName,
) {
  const profile = SOURCE_PROFILES[sourceProfile];
  const provenance = object(value, "provenance");
  if (
    provenance.schema !== profile.durableSchema || provenance.source_repository !== SOURCE_REPOSITORY ||
    provenance.workflow_path !== profile.workflowPath || !GIT_SHA.test(String(provenance.workflow_source_sha ?? "")) ||
    !/^\d+$/.test(String(provenance.workflow_run_id ?? "")) ||
    !Number.isInteger(provenance.workflow_run_attempt) || Number(provenance.workflow_run_attempt) < 1 ||
    provenance.market_date !== marketDate || provenance.evidence_sha256 !== evidenceSha || !SHA256.test(evidenceSha) ||
    provenance.create_once_commit_path !== `${profile.namespace}/${marketDate}` || provenance.research_only !== true ||
    provenance.source_only !== true || provenance.credential_required !== false ||
    provenance.provider_confirmed_fill_evidence !== false || provenance.recommendation_authority !== false ||
    provenance.order_authority !== false || provenance.capital_risk_authority !== false ||
    provenance.trading_authority !== false || provenance.production_activation !== false ||
    provenance.active_trading_capability_changed !== false || provenance.automatic_production_activation !== false
  ) throw new Error("durable provenance identity or authority is invalid");
}

function durablePath(root: string, marketDate: string, sourceProfile: SourceProfileName) {
  if (!isIsoDate(marketDate)) throw new Error("market date is malformed");
  return `${root.replace(/\/+$/, "")}/${SOURCE_PROFILES[sourceProfile].namespace}/${marketDate}`;
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("market date is malformed");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function object(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed`);
  return value as Record<string, unknown>;
}

async function sha256(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function main(raw: string[]) {
  const command = raw[0];
  const args = parseArgs(raw.slice(1));
  const marketDate = args.get("--market-date") ?? "";
  const sourceProfile = parseSourceProfile(args.get("--source-profile") ?? "f042");
  const expectedSize = args.has("--source-profile") ? 2 : 1;
  if (command === "preflight" && args.size === expectedSize) {
    console.log(await inspectDurableEvidence(".", marketDate, sourceProfile));
    return;
  }
  if (command === "preserve" && args.size === expectedSize + 4) {
    console.log(
      await preserveEvidence({
        root: ".",
        marketDate,
        sourceDir: args.get("--source-dir") ?? "",
        workflowSourceSha: args.get("--workflow-source-sha") ?? "",
        workflowRunId: args.get("--workflow-run-id") ?? "",
        workflowRunAttempt: Number(args.get("--workflow-run-attempt")),
        sourceProfile,
      }),
    );
    return;
  }
  throw new Error("persistence command or arguments are malformed");
}

function parseSourceProfile(value: string): SourceProfileName {
  if (value !== "f042" && value !== "f066") throw new Error("source profile is malformed");
  return value;
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
