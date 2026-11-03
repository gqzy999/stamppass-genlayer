import json

import pytest

from conftest import (
    _UserError,
    clear_web,
    fresh_contract,
    mock_web,
    mock_web_error,
    set_sender,
)

ALICE = "0xAbC1230000000000000000000000000000000001"
BOB = "0xDeF4560000000000000000000000000000000002"


def _claim(c, name="Example Domain", date="2026-11-01", url="https://example.com", note="Attended"):
    c.claim_attendance(name, date, url, note)


def test_claim_creates_pending():
    c = fresh_contract()
    set_sender(ALICE)
    _claim(c)
    assert json.loads(c.get_claim("claim-1"))["status"] == "PENDING"
    assert c.get_claim_id("0") == "claim-1"
    counts = json.loads(c.get_counts())
    assert counts == {"claims": 1, "stamps": 0, "pending": 1, "stamped": 0, "unverified": 0}


def test_claim_validation():
    c = fresh_contract()
    set_sender(ALICE)
    bad = [
        ("", "2026-11-01", "https://example.com", "x"),
        ("x" * 101, "2026-11-01", "https://example.com", "x"),
        ("Event", "2026-13-01", "https://example.com", "x"),
        ("Event", "20261101", "https://example.com", "x"),
        ("Event", "2026-11-01", "http://example.com", "x"),
        ("Event", "2026-11-01", "https://", "x"),
        ("Event", "2026-11-01", "https://example.com", "x" * 501),
    ]
    for name, date, url, note in bad:
        with pytest.raises(_UserError) as exc:
            c.claim_attendance(name, date, url, note)
        assert exc.value.data == "INVALID_INPUT"
    assert json.loads(c.get_counts())["claims"] == 0


def test_duplicate_guard_case_insensitive():
    c = fresh_contract()
    set_sender(ALICE)
    _claim(c, name="Example Domain", date="2026-11-01")
    with pytest.raises(_UserError) as exc:
        _claim(c, name="example domain", date="2026-11-01")
    assert exc.value.data == "DUPLICATE_CLAIM"
    assert json.loads(c.get_counts())["claims"] == 1


def test_same_name_different_date_and_other_claimer_allowed():
    c = fresh_contract()
    set_sender(ALICE)
    _claim(c, name="Example Domain", date="2026-11-01")
    _claim(c, name="Example Domain", date="2026-11-02")
    set_sender(BOB)
    _claim(c, name="Example Domain", date="2026-11-01")
    assert json.loads(c.get_counts())["claims"] == 3


def test_cap_32_then_33rd_fails():
    c = fresh_contract()
    set_sender(ALICE)
    for i in range(1, 33):
        _claim(c, name="Cap Event %d" % i, date="2026-12-%02d" % i if i <= 28 else "2027-01-%02d" % (i - 28))
    assert json.loads(c.get_counts())["claims"] == 32
    with pytest.raises(_UserError) as exc:
        _claim(c, name="Cap Event 33", date="2027-02-01")
    assert exc.value.data == "CAP_REACHED"
    assert json.loads(c.get_counts())["claims"] == 32


def test_verify_stamped_creates_stamp_and_passport():
    c = fresh_contract()
    set_sender(ALICE)
    _claim(c)
    mock_web("https://example.com", 200, "Welcome to Example Domain, a sample event page.")
    c.verify_attendance("claim-1")
    assert json.loads(c.get_claim("claim-1"))["status"] == "STAMPED"
    stamp = json.loads(c.get_stamp("stamp-1"))
    assert stamp["event_name"] == "Example Domain"
    assert stamp["event_date"] == "2026-11-01"
    passport = json.loads(c.get_passport(ALICE))
    assert passport["total_stamps"] == 1
    assert passport["distinct_events"] == 1
    assert passport["stamps_last_30d"] == 1
    assert passport["milestones"] == ["First Stamp"]
    assert passport["latest_event_date"] == "2026-11-01"


def test_verify_unverified_creates_no_stamp():
    c = fresh_contract()
    set_sender(ALICE)
    _claim(c, name="Quantum Summit 2026", date="2026-11-02")
    mock_web("https://example.com", 200, "Welcome to Example Domain, a sample event page.")
    c.verify_attendance("claim-1")
    assert json.loads(c.get_claim("claim-1"))["status"] == "UNVERIFIED"
    assert c.get_stamp("stamp-1") == ""
    assert json.loads(c.get_counts())["stamps"] == 0
    assert json.loads(c.get_counts())["unverified"] == 1


def test_verify_fail_closed_404_stays_pending():
    c = fresh_contract()
    set_sender(ALICE)
    _claim(c, name="RustConf 2026", date="2026-11-03", url="https://github.com/no-such-user-xyz/no-such-repo-xyz")
    mock_web("https://github.com/no-such-user-xyz/no-such-repo-xyz", 404, "Not Found")
    c.verify_attendance("claim-1")
    assert json.loads(c.get_claim("claim-1"))["status"] == "PENDING"
    assert json.loads(c.get_counts())["stamps"] == 0


def test_verify_fail_closed_exception_stays_pending():
    c = fresh_contract()
    set_sender(ALICE)
    _claim(c, name="RustConf 2026", date="2026-11-03", url="https://example.com/down")
    mock_web_error("https://example.com/down", Exception("dns failure"))
    c.verify_attendance("claim-1")
    assert json.loads(c.get_claim("claim-1"))["status"] == "PENDING"


def test_verify_invalid_status_and_not_found():
    c = fresh_contract()
    set_sender(ALICE)
    _claim(c)
    mock_web("https://example.com", 200, "Example Domain")
    c.verify_attendance("claim-1")
    with pytest.raises(_UserError) as exc:
        c.verify_attendance("claim-1")
    assert exc.value.data == "INVALID_STATUS"
    with pytest.raises(_UserError) as exc:
        c.verify_attendance("claim-99")
    assert exc.value.data == "NOT_FOUND"


def test_streaks_window_and_distinct_events():
    c = fresh_contract()
    set_sender(ALICE)
    _claim(c, name="Old Event", date="2026-10-01", url="https://example.com/old")
    _claim(c, name="New Event", date="2026-11-10", url="https://example.com/new")
    mock_web("https://example.com/old", 200, "Old Event happened here.")
    mock_web("https://example.com/new", 200, "New Event happened here.")
    c.verify_attendance("claim-1")
    c.verify_attendance("claim-2")
    streaks = json.loads(c.get_streaks(ALICE))
    assert streaks["total_stamps"] == 2
    assert streaks["distinct_events"] == 2
    assert streaks["stamps_last_30d"] == 1
    assert streaks["latest_event_date"] == "2026-11-10"
    assert streaks["milestones"] == ["First Stamp"]


def test_distinct_events_case_insensitive():
    c = fresh_contract()
    set_sender(ALICE)
    _claim(c, name="Example Domain", date="2026-11-01", url="https://example.com/a")
    _claim(c, name="EXAMPLE DOMAIN", date="2026-11-02", url="https://example.com/b")
    mock_web("https://example.com/a", 200, "Example Domain")
    mock_web("https://example.com/b", 200, "example domain")
    c.verify_attendance("claim-1")
    c.verify_attendance("claim-2")
    passport = json.loads(c.get_passport(ALICE))
    assert passport["total_stamps"] == 2
    assert passport["distinct_events"] == 1


def test_milestones_thresholds():
    from conftest import load_contract

    mod = load_contract()
    assert mod._milestones_for(0) == []
    assert mod._milestones_for(1) == ["First Stamp"]
    assert mod._milestones_for(5) == ["First Stamp", "Collector"]
    assert mod._milestones_for(10) == ["First Stamp", "Collector", "Globetrotter"]
    assert mod._milestones_for(25) == ["First Stamp", "Collector", "Globetrotter", "World Traveler"]


def test_counts_and_claimer_listing():
    c = fresh_contract()
    set_sender(ALICE)
    _claim(c, name="Example Domain", date="2026-11-01")
    _claim(c, name="Other Event", date="2026-11-02")
    set_sender(BOB)
    _claim(c, name="Example Domain", date="2026-11-01")
    mock_web("https://example.com", 200, "Example Domain")
    set_sender(ALICE)
    c.verify_attendance("claim-1")
    counts = json.loads(c.get_counts())
    assert counts == {"claims": 3, "stamps": 1, "pending": 2, "stamped": 1, "unverified": 0}
    mine = json.loads(c.get_claims_by_claimer(ALICE.lower()))
    assert [r["claim_id"] for r in mine] == ["claim-1", "claim-2"]
    assert json.loads(c.get_claims_by_claimer(BOB.lower()))[0]["claim_id"] == "claim-3"
