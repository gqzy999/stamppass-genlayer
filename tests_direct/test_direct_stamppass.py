import json

import pytest

from gltest.direct.loader import create_address


def _code_of(exc):
    for attr in ("message", "data"):
        value = getattr(exc.value, attr, None)
        if value is not None:
            return value
    return str(exc.value)


def _deploy(direct_deploy):
    return direct_deploy("contracts/stamppass.py")


def test_direct_claim_verify_stamped(direct_vm, direct_deploy):
    c = _deploy(direct_deploy)
    alice = create_address("alice")
    direct_vm.sender = alice
    c.claim_attendance("Example Domain", "2026-11-01", "https://example.com", "Attended")
    claim = json.loads(c.get_claim("claim-1"))
    assert claim["status"] == "PENDING"
    claimer = claim["claimer"]
    direct_vm.mock_web("example.com", {"method": "GET", "status": 200, "body": "Welcome to Example Domain."})
    c.verify_attendance("claim-1")
    assert json.loads(c.get_claim("claim-1"))["status"] == "STAMPED"
    stamp = json.loads(c.get_stamp("stamp-1"))
    assert stamp["event_name"] == "Example Domain"
    passport = json.loads(c.get_passport(claimer))
    assert passport["total_stamps"] == 1
    assert passport["distinct_events"] == 1
    assert passport["stamps_last_30d"] == 1
    assert passport["milestones"] == ["First Stamp"]


def test_direct_verify_unverified(direct_vm, direct_deploy):
    c = _deploy(direct_deploy)
    direct_vm.sender = create_address("alice")
    c.claim_attendance("Quantum Summit 2026", "2026-11-02", "https://example.com", "Attended")
    direct_vm.mock_web("example.com", {"method": "GET", "status": 200, "body": "Welcome to Example Domain."})
    c.verify_attendance("claim-1")
    assert json.loads(c.get_claim("claim-1"))["status"] == "UNVERIFIED"
    assert c.get_stamp("stamp-1") == ""
    assert json.loads(c.get_counts())["stamps"] == 0


def test_direct_verify_fail_closed_404(direct_vm, direct_deploy):
    c = _deploy(direct_deploy)
    direct_vm.sender = create_address("alice")
    c.claim_attendance("RustConf 2026", "2026-11-03", "https://github.com/no-such-user-xyz/no-such-repo-xyz", "Attended")
    direct_vm.mock_web("github.com", {"method": "GET", "status": 404, "body": "Not Found"})
    c.verify_attendance("claim-1")
    assert json.loads(c.get_claim("claim-1"))["status"] == "PENDING"
    assert json.loads(c.get_counts())["stamps"] == 0


def test_direct_guards(direct_vm, direct_deploy):
    c = _deploy(direct_deploy)
    direct_vm.sender = create_address("alice")
    c.claim_attendance("Example Domain", "2026-11-01", "https://example.com", "Attended")
    with pytest.raises(Exception) as exc:
        c.claim_attendance("example domain", "2026-11-01", "https://example.com", "Again")
    assert _code_of(exc) == "DUPLICATE_CLAIM"
    with pytest.raises(Exception) as exc:
        c.claim_attendance("Bad Event", "2026-13-01", "https://example.com", "Bad date")
    assert _code_of(exc) == "INVALID_INPUT"
    with pytest.raises(Exception) as exc:
        c.verify_attendance("claim-99")
    assert _code_of(exc) == "NOT_FOUND"
    assert json.loads(c.get_counts())["claims"] == 1


def test_direct_two_stamps_streaks(direct_vm, direct_deploy):
    c = _deploy(direct_deploy)
    direct_vm.sender = create_address("alice")
    c.claim_attendance("Example Domain", "2026-11-01", "https://example.com", "Attended")
    c.claim_attendance("Example", "2026-11-03", "https://example.org", "Attended")
    claimer = json.loads(c.get_claim("claim-1"))["claimer"]
    direct_vm.mock_web("example.com", {"method": "GET", "status": 200, "body": "Welcome to Example Domain."})
    direct_vm.mock_web("example.org", {"method": "GET", "status": 200, "body": "Example Domain, an example site."})
    c.verify_attendance("claim-1")
    c.verify_attendance("claim-2")
    streaks = json.loads(c.get_streaks(claimer))
    assert streaks["total_stamps"] == 2
    assert streaks["distinct_events"] == 2
    assert streaks["stamps_last_30d"] == 2
    assert streaks["latest_event_date"] == "2026-11-03"
    counts = json.loads(c.get_counts())
    assert counts == {"claims": 2, "stamps": 2, "pending": 0, "stamped": 2, "unverified": 0}
