# StampPass — Attendance passport

Live site: https://gqzy999.github.io/stamppass-genlayer/

Contract (Stable Studionet, chain 61999): https://explorer-studio.genlayer.com/address/0x026ECEb13c0b40522237E0168C6518dda82e7C44

StampPass turns event attendance into a passport book. Anyone claims
attendance at an event with an evidence page; independent validators fetch
that page and must agree it references the event. Agreement adds an ink
stamp to the claimer's passport, and the passport's totals and milestones
evolve. This is a stamp collection, not a record list.

## How it works

1. **Claim** — `claim_attendance(event_name, event_date, evidence_url, note)`
   records an attendance claim. One claim per event per date per claimer,
   and each claimer may hold at most 32 claims.
2. **Verify** — `verify_attendance(claim_id)` asks validators to fetch the
   evidence page and agree. Agreement that the page references the event
   stamps the claim; agreement that it does not leaves the claim
   `UNVERIFIED` and adds no stamp.
3. **Fail closed** — if the evidence page is unreachable, or validators do
   not agree, the claim stays `PENDING` and can be presented again later.
   No stamp is added on a failed check.
4. **Passport** — `get_passport` returns the holder's stamps, total stamps,
   distinct events, stamps in the last 30 days, latest stamp date, and
   milestones (First Stamp at 1, Collector at 5, Globetrotter at 10,
   World Traveler at 25).

## Scope, stated plainly

- A stamp attests that validators agreed the evidence page references the
  event. It is not cryptographic proof of physical presence.
- Evidence must be a public `https` page. Event dates are supplied by the
  claimer. Stamps, once added, are never overwritten.
- The last-30-days count is measured from the passport's most recent stamp
  date, because the chain has no wall clock.
- The contract holds no funds and no escrow. Transactions on Studionet cost
  no real money.

## Contract methods

| Method | Type | Purpose |
| --- | --- | --- |
| `claim_attendance(event_name, event_date, evidence_url, note)` | write | Claim an attendance |
| `verify_attendance(claim_id)` | write | Present a claim for stamping |
| `get_claim(claim_id)` | view | One claim |
| `get_claim_id(index)` | view | Claim ID by index |
| `get_claims_by_claimer(claimer)` | view | All claims of one holder |
| `get_stamp(stamp_id)` | view | One stamp |
| `get_passport(claimer)` | view | Full passport with stamps and milestones |
| `get_streaks(claimer)` | view | Passport stats without the stamp list |
| `get_counts()` | view | Ledger totals |

## Frontend

The site is a passport book: a cover with the holder and totals, then one
visa page per claim — ink stamps for stamped events, refused marks for
unsupported claims, dashed awaiting slots for pending claims. Turn pages
with the buttons or the arrow keys. Reads need no wallet; anyone can open
any passport by address.

Any injected EVM wallet can connect and read. Writes from an injected
wallet are signed by that wallet; reviewers without a wallet can use the
clearly labelled in-browser reviewer test account, which generates a
temporary key in the tab, never sends it anywhere, and is shown honestly
as a test account, never as a wallet signature.

To run locally:

```sh
cd frontend
npm install
npm run dev
```

To build for the deployed contract:

```sh
cd frontend
VITE_CONTRACT_ADDRESS=<contract address> npm run build
```

## Evidence

- `evidence.json` — deployment, every loop transaction, and read-back
  results in machine-readable form.
- `EVIDENCE.md` — the same results in readable form, with the full loop
  narrative and the known limits.
- `scripts/verify-loop.mjs` — the loop that deploys fresh and proves the
  STAMPED, UNVERIFIED, fail-closed, duplicate-guard, and cap paths, with
  an independent read-back after every step.
- `tests/` — stand-in unit tests; `tests_direct/` — tests against the real
  GenVM runtime.
