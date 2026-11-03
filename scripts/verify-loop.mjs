import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FLOW_PATH = join(root, "evidence", "loop-flow.json");
const DEPLOY_PATH = join(root, "evidence", "deployment.json");

const client = createClient({ chain: studionet });
const source = readFileSync(join(root, "contracts", "stamppass.py"), "utf-8");
const sourceSha256 = createHash("sha256").update(source).digest("hex");

const flow = {
  contractAddress: null,
  deployTx: null,
  sourceSha256,
  chainId: 61999,
  verified: false,
  accounts: {},
  steps: [],
  finalCounts: null,
  finalPassport: null,
};

function checkpoint() {
  writeFileSync(FLOW_PATH, JSON.stringify(flow, null, 2) + "\n");
}

function assertEq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function assertGasZero() {
  try {
    const price = await client.getGasPrice();
    if (price !== 0n) {
      throw new Error("non-zero gas price: " + String(price));
    }
  } catch (e) {
    if (String(e.message).startsWith("non-zero")) throw e;
    console.log("gas-price check unavailable, continuing:", String(e.message).slice(0, 120));
  }
}

async function waitFinalized(hash) {
  let last = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      return await client.waitForTransactionReceipt({
        hash,
        status: "FINALIZED",
        interval: 3000,
        retries: 200,
      });
    } catch (e) {
      last = e;
      const msg = String(e?.message || e);
      const transient =
        msg.includes("<!DOCTYPE") ||
        msg.includes("not valid JSON") ||
        msg.includes("UnknownRpcError") ||
        msg.includes("eth_getTransactionByHash");
      if (!transient) throw e;
      console.log("transient RPC error polling", hash.slice(0, 14), "- retry in 15s (attempt", attempt + 1, ")");
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
  throw last;
}

let address = null;

async function write(label, account, fn, args, expected) {
  await assertGasZero();
  const hash = await client.writeContract({ address, functionName: fn, args, account });
  await waitFinalized(hash);
  const tx = await client.getTransaction({ hash });
  const lr = tx.consensus_data?.leader_receipt?.[0];
  const exec = lr?.execution_result ?? tx.txExecutionResultName ?? "UNKNOWN";
  const err = lr?.error ?? null;
  const payload = lr?.result?.payload ?? null;
  const step = { label, hash, executionResult: exec, error: err, resultPayload: payload };
  flow.steps.push(step);
  checkpoint();
  const statusOk = tx.status === 7 || tx.statusName === "FINALIZED";
  if (!statusOk) {
    console.log("receipt shape for failed status check:", JSON.stringify({ status: tx.status, statusName: tx.statusName, lr }, null, 2).slice(0, 2000));
    throw new Error(`${label}: tx not FINALIZED (status=${tx.status} statusName=${tx.statusName})`);
  }
  if (expected === "SUCCESS") {
    if (exec !== "SUCCESS") {
      console.log("receipt for failed SUCCESS step:", JSON.stringify(lr, null, 2).slice(0, 2000));
      throw new Error(`${label}: expected SUCCESS, got ${exec} (error: ${err} payload: ${payload})`);
    }
  } else {
    if (exec === "SUCCESS") {
      throw new Error(`${label}: expected ERROR (${expected}), got SUCCESS`);
    }
    const hay = (String(exec) + " " + String(err ?? "") + " " + String(payload ?? "")).toUpperCase();
    if (!hay.includes(expected)) {
      console.log("receipt for failed ERROR step:", JSON.stringify(lr, null, 2).slice(0, 2000));
      throw new Error(`${label}: expected code ${expected} in exec=${exec} error=${err} payload=${payload}`);
    }
  }
  console.log(label, exec, address);
  return { hash, exec, err };
}

async function read(fn, args) {
  return client.readContract({ address, functionName: fn, args });
}

async function readJson(fn, args) {
  const raw = await read(fn, args);
  return raw === "" ? null : JSON.parse(raw);
}

async function main() {
  const claimer = createAccount();
  const capper = createAccount();
  flow.accounts.claimer = claimer.address;
  flow.accounts.capper = capper.address;
  checkpoint();

  await assertGasZero();
  const deployHash = await client.deployContract({ code: source, account: claimer });
  await waitFinalized(deployHash);
  const deployTx = await client.getTransaction({ hash: deployHash });
  address = deployTx.data?.contract_address ?? deployTx.to_address;
  if (!address) {
    console.log("deploy tx shape:", JSON.stringify(deployTx, null, 2).slice(0, 2000));
    throw new Error("deploy address not found in tx.data.contract_address");
  }
  const deployExec = deployTx.consensus_data?.leader_receipt?.[0]?.execution_result ?? deployTx.txExecutionResultName;
  flow.contractAddress = address;
  flow.deployTx = deployHash;
  flow.steps.push({ label: "deploy", hash: deployHash, executionResult: deployExec, error: deployTx.consensus_data?.leader_receipt?.[0]?.error ?? null });
  checkpoint();
  assertEq(deployExec, "SUCCESS", "deploy execution");
  console.log("deployed:", address, "tx:", deployHash);

  const counts0 = await readJson("get_counts", []);
  assertEq(counts0.claims, 0, "initial claims");
  assertEq(counts0.stamps, 0, "initial stamps");

  await write("create-A", claimer, "claim_attendance", ["Example Domain", "2026-11-01", "https://example.com", "Attended the Example Domain showcase."], "SUCCESS");
  assertEq((await readJson("get_claim", ["claim-1"])).status, "PENDING", "claim-1 after create");

  await write("verify-A", claimer, "verify_attendance", ["claim-1"], "SUCCESS");
  assertEq((await readJson("get_claim", ["claim-1"])).status, "STAMPED", "claim-1 after verify");
  const stamp1 = await readJson("get_stamp", ["stamp-1"]);
  assertEq(stamp1.event_name, "Example Domain", "stamp-1 event");
  const passport1 = await readJson("get_passport", [claimer.address]);
  assertEq(passport1.total_stamps, 1, "passport total after A");
  assertEq(passport1.distinct_events, 1, "passport distinct after A");
  assertEq(passport1.stamps_last_30d, 1, "passport recent after A");

  await write("create-B", claimer, "claim_attendance", ["Quantum Summit 2026", "2026-11-02", "https://example.com", "Attended the summit."], "SUCCESS");
  await write("verify-B", claimer, "verify_attendance", ["claim-2"], "SUCCESS");
  assertEq((await readJson("get_claim", ["claim-2"])).status, "UNVERIFIED", "claim-2 after verify");
  assertEq((await readJson("get_counts", [])).stamps, 1, "stamps after B");

  await write("create-C", claimer, "claim_attendance", ["RustConf 2026", "2026-11-03", "https://github.com/stamppass-no-such-user-xyz/no-such-repo-xyz", "Attended RustConf."], "SUCCESS");
  await write("verify-C", claimer, "verify_attendance", ["claim-3"], "SUCCESS");
  assertEq((await readJson("get_claim", ["claim-3"])).status, "PENDING", "claim-3 fail-closed stays PENDING");
  assertEq((await readJson("get_counts", [])).stamps, 1, "stamps after C");

  await write("duplicate-A", claimer, "claim_attendance", ["example domain", "2026-11-01", "https://example.com", "Duplicate attempt."], "DUPLICATE_CLAIM");
  assertEq((await readJson("get_counts", [])).claims, 3, "claims after duplicate");

  await write("create-D", claimer, "claim_attendance", ["Example", "2026-11-04", "https://example.com", "Attended the Example meetup."], "SUCCESS");
  await write("verify-D", claimer, "verify_attendance", ["claim-4"], "SUCCESS");
  assertEq((await readJson("get_claim", ["claim-4"])).status, "STAMPED", "claim-4 after verify");
  const passport2 = await readJson("get_passport", [claimer.address]);
  assertEq(passport2.total_stamps, 2, "passport total after D");
  assertEq(passport2.distinct_events, 2, "passport distinct after D");
  assertEq(passport2.stamps_last_30d, 2, "passport recent after D");
  assertEq(JSON.stringify(passport2.milestones), JSON.stringify(["First Stamp"]), "passport milestones after D");
  const streaks = await readJson("get_streaks", [claimer.address]);
  assertEq(streaks.total_stamps, 2, "streaks total");
  assertEq(streaks.latest_event_date, "2026-11-04", "streaks latest date");

  for (let n = 1; n <= 32; n++) {
    const date = n <= 28 ? `2026-12-${String(n).padStart(2, "0")}` : `2027-01-${String(n - 28).padStart(2, "0")}`;
    await write(`cap-claim-${n}`, capper, "claim_attendance", [`Cap Event ${n}`, date, "https://example.com", "Cap test claim."], "SUCCESS");
  }
  const capperClaims = JSON.parse(await read("get_claims_by_claimer", [capper.address]));
  assertEq(capperClaims.length, 32, "capper claims");
  await write("cap-claim-33", capper, "claim_attendance", ["Cap Event 33", "2027-02-01", "https://example.com", "Over the cap."], "CAP_REACHED");
  assertEq(JSON.parse(await read("get_claims_by_claimer", [capper.address])).length, 32, "capper claims after 33rd");

  await write("invalid-date", claimer, "claim_attendance", ["Bad Event", "2026-13-01", "https://example.com", "Bad date."], "INVALID_INPUT");
  await write("verify-missing", claimer, "verify_attendance", ["claim-99"], "NOT_FOUND");
  await write("verify-stamped-again", claimer, "verify_attendance", ["claim-1"], "INVALID_STATUS");

  const counts = await readJson("get_counts", []);
  assertEq(counts.claims, 36, "final claims");
  assertEq(counts.stamps, 2, "final stamps");
  assertEq(counts.pending, 33, "final pending");
  assertEq(counts.stamped, 2, "final stamped");
  assertEq(counts.unverified, 1, "final unverified");
  flow.finalCounts = counts;
  flow.finalPassport = await readJson("get_passport", [claimer.address]);
  flow.verified = true;
  checkpoint();
  writeFileSync(DEPLOY_PATH, JSON.stringify({
    contractAddress: address,
    network: "studionet",
    chainId: 61999,
    sourceSha256,
    deployTx: deployHash,
    counts,
    verified: true,
  }, null, 2) + "\n");
  console.log("VERIFIED. contract:", address);
  console.log("counts:", JSON.stringify(counts));
}

main().catch((e) => {
  console.error("LOOP FAILED:", e);
  try { checkpoint(); } catch {}
  process.exit(1);
});
