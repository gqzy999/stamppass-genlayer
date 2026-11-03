import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const client = createClient({ chain: studionet });
const source = readFileSync(join(root, "contracts", "stamppass.py"), "utf-8");
const account = createAccount();
const hash = await client.deployContract({ code: source, account });
const receipt = await client.waitForTransactionReceipt({ hash, status: "FINALIZED", interval: 3000, retries: 200 });
const tx = await client.getTransaction({ hash });
const address = tx.data?.contract_address ?? tx.to_address;
console.log("deploy tx:", hash);
console.log("contract:", address);
console.log("execution:", tx.consensus_data?.leader_receipt?.[0]?.execution_result);
writeFileSync(join(root, "evidence", "deployment.json"), JSON.stringify({
  contractAddress: address,
  network: "studionet",
  chainId: 61999,
  sourceSha256: createHash("sha256").update(source).digest("hex"),
  deployTx: hash,
  verified: false,
}, null, 2) + "\n");
