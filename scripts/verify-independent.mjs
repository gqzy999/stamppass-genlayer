import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const flow = JSON.parse(readFileSync(join(root, "evidence/loop-flow.json"), "utf8"));
const deployment = JSON.parse(readFileSync(join(root, "evidence/deployment.json"), "utf8"));
const contract = flow.contractAddress;
const claimer = flow.accounts.claimer;
const capper = flow.accounts.capper;
const client = createClient({ chain: studionet });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail: detail ?? "" });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " :: " + detail : ""));
  if (!ok) process.exitCode = 1;
}

async function spaced(fn) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const out = await fn();
      await sleep(2200);
      return out;
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (msg.includes("-32029") || /rate/i.test(msg)) {
        console.log("rate-limited, backing off 65s (attempt " + (attempt + 1) + ")");
        await sleep(65000);
        continue;
      }
      throw e;
    }
  }
  throw new Error("exhausted retries");
}

async function readJson(fn, args) {
  const raw = await spaced(() => client.readContract({ address: contract, functionName: fn, args }));
  return raw === "" ? null : JSON.parse(raw);
}

const source = readFileSync(join(root, "contracts/stamppass.py"), "utf8");
const sha = createHash("sha256").update(source).digest("hex");
check("repo contract sha matches loop", sha === flow.sourceSha256, sha);
check("deployment.json sha matches loop", deployment.sourceSha256 === flow.sourceSha256, deployment.sourceSha256);
check("deployment.json address matches loop", deployment.contractAddress === contract, deployment.contractAddress);
check("deployment.json verified flag", deployment.verified === true, String(deployment.verified));

const deployTx = await spaced(() => client.getTransaction({ hash: flow.deployTx }));
check("deploy tx FINALIZED", deployTx.status === 7 || deployTx.statusName === "FINALIZED", String(deployTx.status));
check("deploy tx contract address", (deployTx.data?.contract_address ?? deployTx.to_address) === contract, deployTx.data?.contract_address);
check(
  "deploy tx execution SUCCESS",
  deployTx.consensus_data?.leader_receipt?.[0]?.execution_result === "SUCCESS",
  deployTx.consensus_data?.leader_receipt?.[0]?.execution_result
);

const counts = await readJson("get_counts", []);
check("counts claims 36", counts.claims === 36, JSON.stringify(counts));
check("counts stamps 2", counts.stamps === 2, JSON.stringify(counts));
check("counts pending 33", counts.pending === 33, JSON.stringify(counts));
check("counts stamped 2", counts.stamped === 2, JSON.stringify(counts));
check("counts unverified 1", counts.unverified === 1, JSON.stringify(counts));

const passport = await readJson("get_passport", [claimer]);
check("passport total 2", passport.total_stamps === 2, JSON.stringify(passport.total_stamps));
check("passport distinct 2", passport.distinct_events === 2, JSON.stringify(passport.distinct_events));
check("passport recent 2", passport.stamps_last_30d === 2, JSON.stringify(passport.stamps_last_30d));
check("passport latest 2026-11-04", passport.latest_event_date === "2026-11-04", passport.latest_event_date);
check("passport milestones", JSON.stringify(passport.milestones) === JSON.stringify(["First Stamp"]), JSON.stringify(passport.milestones));
check(
  "passport stamps",
  passport.stamps.length === 2 &&
    passport.stamps[0].stamp_id === "stamp-1" &&
    passport.stamps[0].event_name === "Example Domain" &&
    passport.stamps[0].claim_id === "claim-1" &&
    passport.stamps[1].stamp_id === "stamp-2" &&
    passport.stamps[1].event_name === "Example" &&
    passport.stamps[1].claim_id === "claim-4",
  JSON.stringify(passport.stamps)
);

const streaks = await readJson("get_streaks", [claimer]);
check("streaks total 2", streaks.total_stamps === 2, JSON.stringify(streaks.total_stamps));
check("streaks latest 2026-11-04", streaks.latest_event_date === "2026-11-04", streaks.latest_event_date);

const stamp1 = await readJson("get_stamp", ["stamp-1"]);
check("stamp-1 event", stamp1.event_name === "Example Domain", JSON.stringify(stamp1));
const stamp2 = await readJson("get_stamp", ["stamp-2"]);
check("stamp-2 event", stamp2.event_name === "Example", JSON.stringify(stamp2));

const claim2 = await readJson("get_claim", ["claim-2"]);
check("claim-2 UNVERIFIED", claim2.status === "UNVERIFIED", claim2.status);
const claim3 = await readJson("get_claim", ["claim-3"]);
check("claim-3 PENDING fail-closed", claim3.status === "PENDING", claim3.status);

const claimerClaims = await readJson("get_claims_by_claimer", [claimer]);
check("claimer claims 4", claimerClaims.length === 4, String(claimerClaims.length));
const capperClaims = await readJson("get_claims_by_claimer", [capper]);
check("capper claims 32", capperClaims.length === 32, String(capperClaims.length));

const txResults = [];
for (const step of flow.steps) {
  const tx = await spaced(() => client.getTransaction({ hash: step.hash }));
  const lr = tx.consensus_data?.leader_receipt?.[0];
  const fin = tx.status === 7 || tx.statusName === "FINALIZED";
  const exec = lr?.execution_result ?? tx.txExecutionResultName ?? "UNKNOWN";
  const payload = lr?.result?.payload ?? null;
  const ok = fin && exec === step.executionResult && (step.executionResult !== "ERROR" || payload === step.resultPayload);
  txResults.push({ label: step.label, hash: step.hash, finalized: fin, executionResult: exec, resultPayload: payload, match: ok });
  if (!ok) {
    check("tx " + step.label, false, "expected " + step.executionResult + "/" + step.resultPayload + " got " + exec + "/" + payload);
  }
}
check("all loop txs re-verified FINALIZED with matching results", txResults.every((t) => t.match), txResults.length + " txs");

const out = {
  contract,
  deployTx: flow.deployTx,
  sourceSha256: sha,
  checks,
  txResults,
  allPass: checks.every((c) => c.ok),
};
writeFileSync(join(root, "evidence/independent-check.json"), JSON.stringify(out, null, 2));
console.log(out.allPass ? "INDEPENDENT CHECK: ALL PASS" : "INDEPENDENT CHECK: FAILURES PRESENT");
