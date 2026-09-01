import { assertEquals, assertRejects } from "@std/assert";
import { inspectDurableEvidence, preserveEvidence } from "./persist.ts";

const MARKET_DATE = "2026-09-02";

Deno.test("durable evidence is checksum-bound, authority-free, and create-once", async () => {
  const root = await Deno.makeTempDir({ dir: "/var/tmp", prefix: "nbm-durable-test-" });
  const sourceDir = `${root}/source`;
  await Deno.mkdir(sourceDir);
  const evidence = validEvidence();
  const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
  await Deno.writeTextFile(`${sourceDir}/evidence.json`, evidenceText);
  await Deno.writeTextFile(`${sourceDir}/SHA256SUMS`, `${await sha256(evidenceText)}  evidence.json\n`);
  try {
    assertEquals(await inspectDurableEvidence(root, MARKET_DATE), "missing");
    assertEquals(
      await preserveEvidence({
        root,
        marketDate: MARKET_DATE,
        sourceDir,
        workflowSourceSha: "a".repeat(40),
        workflowRunId: "123456",
        workflowRunAttempt: 1,
      }),
      `evidence/${MARKET_DATE}`,
    );
    assertEquals(await inspectDurableEvidence(root, MARKET_DATE), "existing");
    const before = await Deno.readTextFile(`${root}/evidence/${MARKET_DATE}/SHA256SUMS`);
    await assertRejects(
      () =>
        preserveEvidence({
          root,
          marketDate: MARKET_DATE,
          sourceDir,
          workflowSourceSha: "b".repeat(40),
          workflowRunId: "654321",
          workflowRunAttempt: 2,
        }),
      Error,
      "cannot be overwritten",
    );
    assertEquals(await Deno.readTextFile(`${root}/evidence/${MARKET_DATE}/SHA256SUMS`), before);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("durable evidence rejects malformed dates, authority drift, and checksum drift", async () => {
  const root = await Deno.makeTempDir({ dir: "/var/tmp", prefix: "nbm-durable-drift-" });
  const sourceDir = `${root}/source`;
  await Deno.mkdir(sourceDir);
  try {
    await assertRejects(() => inspectDurableEvidence(root, "2026-02-30"), Error, "date");
    const evidence = validEvidence();
    evidence.trading_authority = true;
    const text = `${JSON.stringify(evidence)}\n`;
    await Deno.writeTextFile(`${sourceDir}/evidence.json`, text);
    await Deno.writeTextFile(`${sourceDir}/SHA256SUMS`, `${await sha256(text)}  evidence.json\n`);
    await assertRejects(
      () =>
        preserveEvidence({
          root,
          marketDate: MARKET_DATE,
          sourceDir,
          workflowSourceSha: "a".repeat(40),
          workflowRunId: "123",
          workflowRunAttempt: 1,
        }),
      Error,
      "authority",
    );
    evidence.trading_authority = false;
    const validText = `${JSON.stringify(evidence)}\n`;
    await Deno.writeTextFile(`${sourceDir}/evidence.json`, validText);
    await Deno.writeTextFile(`${sourceDir}/SHA256SUMS`, `${await sha256(validText)}  evidence.json\n`);
    await preserveEvidence({
      root,
      marketDate: MARKET_DATE,
      sourceDir,
      workflowSourceSha: "a".repeat(40),
      workflowRunId: "123",
      workflowRunAttempt: 1,
    });
    await Deno.writeTextFile(`${root}/evidence/${MARKET_DATE}/provenance.json`, "{}\n");
    await assertRejects(() => inspectDurableEvidence(root, MARKET_DATE), Error, "checksum");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("f066 evidence has an independent create-once namespace and provenance", async () => {
  const root = await Deno.makeTempDir({ dir: "/var/tmp", prefix: "nbm-f066-durable-test-" });
  const sourceDir = `${root}/source`;
  await Deno.mkdir(sourceDir);
  const evidence = validEvidence();
  evidence.schema = "noaa_nbm_native_max_t_q95_f066_public_canary_v1";
  evidence.source = {
    source_profile: "f066",
    source_product: "noaa_nbm_blend_qmd_12z_f066_native_max_t_q95_v1",
    market_date: MARKET_DATE,
    valid_interval_start: `${MARKET_DATE}T12:00:00.000Z`,
    valid_interval_end: "2026-09-03T06:00:00.000Z",
  };
  const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
  await Deno.writeTextFile(`${sourceDir}/evidence.json`, evidenceText);
  await Deno.writeTextFile(`${sourceDir}/SHA256SUMS`, `${await sha256(evidenceText)}  evidence.json\n`);
  try {
    assertEquals(await inspectDurableEvidence(root, MARKET_DATE, "f066"), "missing");
    assertEquals(
      await preserveEvidence({
        root,
        marketDate: MARKET_DATE,
        sourceDir,
        workflowSourceSha: "c".repeat(40),
        workflowRunId: "777",
        workflowRunAttempt: 1,
        sourceProfile: "f066",
      }),
      `evidence-f066/${MARKET_DATE}`,
    );
    assertEquals(await inspectDurableEvidence(root, MARKET_DATE, "f066"), "existing");
    assertEquals(await inspectDurableEvidence(root, MARKET_DATE), "missing");
    const provenance = JSON.parse(await Deno.readTextFile(`${root}/evidence-f066/${MARKET_DATE}/provenance.json`));
    assertEquals(provenance.workflow_path, ".github/workflows/f066-daily-source.yml");
    assertEquals(provenance.create_once_commit_path, `evidence-f066/${MARKET_DATE}`);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function validEvidence(): Record<string, unknown> {
  return {
    schema: "noaa_nbm_native_max_t_q95_public_canary_v1",
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
    source: { market_date: MARKET_DATE },
    request_policy: { maximum_requests: 2, actual_requests: 2, no_retry: true, terminal_http_429: true },
    coverage: { stations: 20, complete: true },
    rows: Array.from({ length: 20 }, (_, index) => ({ station_id: `K${index}` })),
  };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
