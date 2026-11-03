# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json


def _days_from_civil(y, m, d):
    y_adj = y - 1 if m <= 2 else y
    era = y_adj // 400 if y_adj >= 0 else (y_adj - 399) // 400
    yoe = y_adj - era * 400
    mp = m - 3 if m > 2 else m + 9
    doy = (153 * mp + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def _parse_date(s):
    if len(s) != 10 or s[4] != "-" or s[7] != "-":
        return None
    digits = s[0:4] + s[5:7] + s[8:10]
    for ch in digits:
        if ch < "0" or ch > "9":
            return None
    y = int(s[0:4])
    m = int(s[5:7])
    d = int(s[8:10])
    if m < 1 or m > 12 or d < 1 or d > 31:
        return None
    return (y, m, d)


def _milestones_for(total):
    out = []
    if total >= 1:
        out.append("First Stamp")
    if total >= 5:
        out.append("Collector")
    if total >= 10:
        out.append("Globetrotter")
    if total >= 25:
        out.append("World Traveler")
    return out


@allow_storage
class StampPass(gl.Contract):
    claims: TreeMap[str, str]
    claim_index: TreeMap[str, str]
    claim_count: u32
    stamps: TreeMap[str, str]
    stamp_index: TreeMap[str, str]
    stamp_count: u32
    claimer_claim_count: TreeMap[str, str]
    dup_guard: TreeMap[str, str]

    def __init__(self):
        self.claim_count = u32(0)
        self.stamp_count = u32(0)

    @gl.public.write
    def claim_attendance(self, event_name: str, event_date: str, evidence_url: str, note: str) -> None:
        if len(event_name) < 1 or len(event_name) > 100:
            raise gl.vm.UserError("INVALID_INPUT")
        if _parse_date(event_date) is None:
            raise gl.vm.UserError("INVALID_INPUT")
        if not evidence_url.startswith("https://") or len(evidence_url) <= 8:
            raise gl.vm.UserError("INVALID_INPUT")
        if len(note) > 500:
            raise gl.vm.UserError("INVALID_INPUT")
        claimer = str(gl.message.sender_address).lower()
        held = int(self.claimer_claim_count.get(claimer, "0"))
        if held >= 32:
            raise gl.vm.UserError("CAP_REACHED")
        guard = claimer + "|" + event_name.lower() + "|" + event_date
        if guard in self.dup_guard:
            raise gl.vm.UserError("DUPLICATE_CLAIM")
        idx = int(self.claim_count)
        claim_id = "claim-" + str(idx + 1)
        record = {
            "claim_id": claim_id,
            "claimer": claimer,
            "event_name": event_name,
            "event_date": event_date,
            "evidence_url": evidence_url,
            "note": note,
            "status": "PENDING",
        }
        self.claims[claim_id] = json.dumps(record)
        self.claim_index[str(idx)] = claim_id
        self.claim_count = u32(idx + 1)
        self.claimer_claim_count[claimer] = str(held + 1)
        self.dup_guard[guard] = claim_id

    @gl.public.write
    def verify_attendance(self, claim_id: str) -> None:
        raw = self.claims.get(claim_id, "")
        if raw == "":
            raise gl.vm.UserError("NOT_FOUND")
        claim = json.loads(raw)
        if claim["status"] != "PENDING":
            raise gl.vm.UserError("INVALID_STATUS")
        url = claim["evidence_url"]
        name = claim["event_name"]

        def check():
            try:
                resp = gl.nondet.web.get(url)
                status = resp.status
                body = resp.body
            except Exception:
                return '{"reachable":"no","mentions":"no"}'
            if status != 200 or body is None:
                return '{"reachable":"no","mentions":"no"}'
            try:
                text = body.decode("utf-8", "ignore")
            except Exception:
                return '{"reachable":"yes","mentions":"no"}'
            mentions = "yes" if name.lower() in text.lower() else "no"
            return '{"reachable":"yes","mentions":"' + mentions + '"}'

        def validator(leader_res):
            return gl.vm.unpack_result(leader_res) == check()

        res = json.loads(gl.vm.run_nondet_unsafe(check, validator))
        if res["reachable"] != "yes":
            return
        if res["mentions"] != "yes":
            claim["status"] = "UNVERIFIED"
            self.claims[claim_id] = json.dumps(claim)
            return
        claim["status"] = "STAMPED"
        self.claims[claim_id] = json.dumps(claim)
        sidx = int(self.stamp_count)
        stamp_id = "stamp-" + str(sidx + 1)
        stamp = {
            "stamp_id": stamp_id,
            "claimer": claim["claimer"],
            "event_name": claim["event_name"],
            "event_date": claim["event_date"],
            "claim_id": claim_id,
        }
        self.stamps[stamp_id] = json.dumps(stamp)
        self.stamp_index[str(sidx)] = stamp_id
        self.stamp_count = u32(sidx + 1)

    @gl.public.view
    def get_claim(self, claim_id: str) -> str:
        return self.claims.get(claim_id, "")

    @gl.public.view
    def get_claim_id(self, index: str) -> str:
        return self.claim_index.get(index, "")

    @gl.public.view
    def get_claims_by_claimer(self, claimer: str) -> str:
        want = claimer.lower()
        out = []
        total = int(self.claim_count)
        i = 0
        while i < total:
            cid = self.claim_index.get(str(i), "")
            if cid != "":
                rec = json.loads(self.claims.get(cid, "{}"))
                if rec.get("claimer", "") == want:
                    out.append(rec)
            i = i + 1
        return json.dumps(out)

    @gl.public.view
    def get_stamp(self, stamp_id: str) -> str:
        return self.stamps.get(stamp_id, "")

    @gl.public.view
    def get_passport(self, claimer: str) -> str:
        want = claimer.lower()
        found = []
        total = int(self.stamp_count)
        i = 0
        while i < total:
            sid = self.stamp_index.get(str(i), "")
            if sid != "":
                rec = json.loads(self.stamps.get(sid, "{}"))
                if rec.get("claimer", "") == want:
                    found.append(rec)
            i = i + 1
        return json.dumps(self._passport_for(want, found))

    @gl.public.view
    def get_streaks(self, claimer: str) -> str:
        want = claimer.lower()
        found = []
        total = int(self.stamp_count)
        i = 0
        while i < total:
            sid = self.stamp_index.get(str(i), "")
            if sid != "":
                rec = json.loads(self.stamps.get(sid, "{}"))
                if rec.get("claimer", "") == want:
                    found.append(rec)
            i = i + 1
        full = self._passport_for(want, found)
        return json.dumps({
            "claimer": want,
            "total_stamps": full["total_stamps"],
            "distinct_events": full["distinct_events"],
            "stamps_last_30d": full["stamps_last_30d"],
            "latest_event_date": full["latest_event_date"],
            "milestones": full["milestones"],
        })

    @gl.public.view
    def get_counts(self) -> str:
        pending = 0
        stamped = 0
        unverified = 0
        total = int(self.claim_count)
        i = 0
        while i < total:
            cid = self.claim_index.get(str(i), "")
            if cid != "":
                rec = json.loads(self.claims.get(cid, "{}"))
                st = rec.get("status", "")
                if st == "PENDING":
                    pending = pending + 1
                elif st == "STAMPED":
                    stamped = stamped + 1
                elif st == "UNVERIFIED":
                    unverified = unverified + 1
            i = i + 1
        return json.dumps({
            "claims": total,
            "stamps": int(self.stamp_count),
            "pending": pending,
            "stamped": stamped,
            "unverified": unverified,
        })

    def _passport_for(self, want, found):
        names = []
        latest_days = None
        latest_date = ""
        for rec in found:
            nm = rec.get("event_name", "").lower()
            if nm not in names:
                names.append(nm)
            parsed = _parse_date(rec.get("event_date", ""))
            if parsed is not None:
                days = _days_from_civil(parsed[0], parsed[1], parsed[2])
                if latest_days is None or days > latest_days:
                    latest_days = days
                    latest_date = rec.get("event_date", "")
        recent = 0
        if latest_days is not None:
            for rec in found:
                parsed = _parse_date(rec.get("event_date", ""))
                if parsed is not None:
                    days = _days_from_civil(parsed[0], parsed[1], parsed[2])
                    if latest_days - days <= 30 and latest_days - days >= 0:
                        recent = recent + 1
        total = len(found)
        return {
            "claimer": want,
            "total_stamps": total,
            "distinct_events": len(names),
            "stamps_last_30d": recent,
            "latest_event_date": latest_date,
            "milestones": _milestones_for(total),
            "stamps": found,
        }
