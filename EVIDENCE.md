# StampPass — Evidence

Network: Stable Studionet, chain 61999, RPC https://studio.genlayer.com/api.
No real funds. All transactions below are FINALIZED on Studionet.

## Deployment

- Contract: `0x026ECEb13c0b40522237E0168C6518dda82e7C44`
- Explorer: https://explorer-studio.genlayer.com/address/0x026ECEb13c0b40522237E0168C6518dda82e7C44
- Deploy tx: `0x64ed6280d06b0aff0db2fea347e8e5faf52a82a8652571678e76c0f231a7cb13`
  (FINALIZED/SUCCESS)
- Source: `contracts/stamppass.py`,
  SHA-256 `86b62f3503d185935be67ffe45d17e1cff80833b9a7ca9d93b1925db066e54d2`
  (matches the repo file byte-for-byte; independently re-checked).
- Machine-readable record: `evidence.json` (all 46 loop transactions).
- Raw loop record: `evidence/loop-flow.json`, `evidence/deployment.json`.
- Independent re-verification: `evidence/independent-check.json`
  (separate client, 27 checks, all 46 loop txs re-fetched and matched:
  FINALIZED with the recorded execution result and payload, 0 mismatches).

## What the loop proved (46 steps, all FINALIZED)

Claimer `0x4a57b8dC518f0170BBBA968f920E7F89DC7C6f71`,
capper `0xfc61be2EAa4e92cFF04F285B84C653f9484247e5`
(ephemeral script accounts; keys held in memory only, never written to disk).

| Path | Claim | Evidence | Result |
| --- | --- | --- | --- |
| STAMPED | claim-1 "Example Domain", 2026-11-01 | https://example.com (page contains the name) | STAMPED, stamp-1 created |
| UNVERIFIED | claim-2 "Quantum Summit 2026", 2026-11-02 | https://example.com (page does not mention it) | UNVERIFIED, no stamp |
| Fail-closed | claim-3 "RustConf 2026", 2026-11-03 | https://github.com/stamppass-no-such-user-xyz/no-such-repo-xyz (unreachable) | stays PENDING, no stamp, tx SUCCESS |
| Duplicate guard | "example domain" (lowercase), 2026-11-01 | — | ERROR `DUPLICATE_CLAIM`, claims unchanged |
| Second stamp | claim-4 "Example", 2026-11-04 | https://example.com | STAMPED, stamp-2 created |
| Cap | capper, 32 claims then a 33rd | — | 32 accepted, 33rd ERROR `CAP_REACHED`, still 32 |
| Invalid input | "Bad Event", 2026-13-01 | — | ERROR `INVALID_INPUT` |
| Not found | verify claim-99 | — | ERROR `NOT_FOUND` |
| Wrong status | verify claim-1 again (already STAMPED) | — | ERROR `INVALID_STATUS` |

Key transactions:

- verify-A (STAMPED): `0x2d1c6f3480…` (full hash in `evidence.json`)
- verify-B (UNVERIFIED): `0xdd10a8d835…`
- verify-C (fail-closed, stays PENDING): `0xfaeb110968…`
- duplicate-A (`DUPLICATE_CLAIM`): `0xb063d218d0…`
- cap-claim-33 (`CAP_REACHED`): `0x32d960d400…`
- invalid-date (`INVALID_INPUT`): `0x61a13564fc…`
- verify-missing (`NOT_FOUND`): `0x22915d008f…`
- verify-stamped-again (`INVALID_STATUS`): `0x195c244dff…`

(Full 46 hashes: `evidence.json` → `loop.steps`, and `evidence/loop-flow.json`.)

## Final read-backs (loop + independent re-check agree)

- Counts: claims 36, stamps 2, pending 33, stamped 2, unverified 1.
- Passport (claimer): total stamps 2, distinct events 2, stamps in the
  last 30 days 2, latest event date 2026-11-04, milestones `["First Stamp"]`.
- stamp-1: Example Domain, 2026-11-01, claim-1.
- stamp-2: Example, 2026-11-04, claim-4.
- claim-2: UNVERIFIED. claim-3: PENDING (fail-closed).
- Claimer claims: 4. Capper claims: 32.

## Attempts

1. Deploy tx `0x92017893…` FINALIZED/ERROR: the GenVM runner reported
   "no contract defined". Cause: the contract class used `@allow_storage`
   but did not subclass `gl.Contract`, which is what registers the class as
   the contract. No contract was created by this tx. Files:
   `evidence/attempt-1-deploy-no-contract.json`,
   `evidence/attempt-1-loop-run.log`.
2. Deploy tx `0xe6c872b9…` FINALIZED/SUCCESS, contract
   `0xCC8f7C6dD161d97f64675D0f8967D71d246C8735`, loop stopped at the
   duplicate-A assertion. Cause: a script assertion bug, not a contract
   failure — the duplicate tx correctly finalized as ERROR with
   `DUPLICATE_CLAIM`, but the script only searched `execution_result` and
   `.error` (empty for UserError rejections) and missed `result.payload`.
   Steps through duplicate-A in this attempt are valid partial evidence;
   the canonical deployment is attempt 3. Files:
   `evidence/attempt-2-duplicate-payload.json`,
   `evidence/attempt-2-loop-run.log`.
3. Full loop VERIFIED, 46 steps, contract
   `0x026ECEb13c0b40522237E0168C6518dda82e7C44`.

## Receipt shape, recorded for future builds

On this network, a UserError rejection finalizes as ERROR with an empty
`.error` field; the guard code is carried in
`leader_receipt[0].result.payload` (for example `DUPLICATE_CLAIM`), and
SUCCESS steps carry a null result payload. Guard proofs therefore rest on
FINALIZED status, the payload code, and state readbacks showing no change.
Separately: the contract class must subclass `gl.Contract`;
`@allow_storage` alone does not register it, and local direct tests do not
enforce this, so they cannot prove Studionet acceptance on this point.

## Scope, stated plainly

- A stamp attests that validators agreed the evidence page references the
  event. It is not cryptographic proof of physical presence.
- Evidence must be a public `https` page. Event dates are supplied by the
  claimer. Stamps, once added, are never overwritten.
- The last-30-days count is measured from the passport's most recent stamp
  date, because the chain has no wall clock.
- The contract holds no funds and no escrow.
- Real extension-wallet signing, real-device rendering, and a UI-driven
  fresh claim flow were not personally verified in this build; the write
  paths were proven end-to-end by script to FINALIZED and read back.
- Live-site browser rendering is verified by the parent step, not in this
  build.

## Tests

- Stand-in unit tests: `tests/` — 14 passed.
- Real GenVM direct tests: `tests_direct/` — 5 passed.
- `genvm-lint check contracts/stamppass.py` — passed, 9 methods
  (7 view, 2 write).
- Frontend: Vite build passes; i18n EN/ZH 86/86, 0 missing keys
  (`frontend/scripts/check-i18n.mjs`).
