"""GET /api/health/entities — flag active companies/searches with failing scrapes."""
from datetime import datetime, timezone, timedelta

from backend.models.db import Company, Search, ScrapeLog


def _log(company_id=None, search_id=None, error=None, is_warning=False, ago_min=0):
    return ScrapeLog(
        company_id=company_id, search_id=search_id, source="test",
        jobs_found=0, new_jobs=0, error=error, is_warning=is_warning,
        duration_seconds=0.0,
        ran_at=datetime.now(timezone.utc) - timedelta(minutes=ago_min),
    )


def _run():
    from backend.main import get_failing_entities
    return get_failing_entities()


def test_company_flagged_on_three_empty(test_db):
    c = Company(name="EmptyCo", active=True)
    test_db.add(c)
    test_db.commit()
    for i in range(3):
        test_db.add(_log(company_id=c.id, is_warning=True, ago_min=i))
    test_db.commit()

    r = _run()
    row = next((x for x in r["companies"] if x["name"] == "EmptyCo"), None)
    assert row is not None
    assert "No results" in row["reason"]


def test_company_flagged_on_three_errors_uses_latest_error(test_db):
    c = Company(name="BrokenCo", active=True)
    test_db.add(c)
    test_db.commit()
    test_db.add(_log(company_id=c.id, error="old error", ago_min=5))
    test_db.add(_log(company_id=c.id, error="mid error", ago_min=3))
    test_db.add(_log(company_id=c.id, error="latest 404", ago_min=0))
    test_db.commit()

    r = _run()
    row = next((x for x in r["companies"] if x["name"] == "BrokenCo"), None)
    assert row is not None
    assert row["reason"] == "latest 404"  # most recent actual error


def test_not_flagged_when_a_recent_scrape_succeeded(test_db):
    c = Company(name="OkCo", active=True)
    test_db.add(c)
    test_db.commit()
    test_db.add(_log(company_id=c.id, is_warning=True, ago_min=2))
    test_db.add(_log(company_id=c.id, is_warning=True, ago_min=1))
    test_db.add(_log(company_id=c.id, is_warning=False, error=None, ago_min=0))  # success
    test_db.commit()

    r = _run()
    assert all(x["name"] != "OkCo" for x in r["companies"])


def test_not_flagged_with_fewer_than_window_logs(test_db):
    c = Company(name="NewCo", active=True)
    test_db.add(c)
    test_db.commit()
    test_db.add(_log(company_id=c.id, is_warning=True, ago_min=1))
    test_db.add(_log(company_id=c.id, is_warning=True, ago_min=0))  # only 2
    test_db.commit()

    r = _run()
    assert all(x["name"] != "NewCo" for x in r["companies"])


def test_inactive_company_not_flagged(test_db):
    c = Company(name="OffCo", active=False)
    test_db.add(c)
    test_db.commit()
    for i in range(3):
        test_db.add(_log(company_id=c.id, error="boom", ago_min=i))
    test_db.commit()

    r = _run()
    assert all(x["name"] != "OffCo" for x in r["companies"])


def test_search_flagged_and_count(test_db):
    s = Search(name="DeadSearch", search_mode="keyword", active=True)
    test_db.add(s)
    test_db.commit()
    for i in range(3):
        test_db.add(_log(search_id=s.id, error="429", ago_min=i))
    test_db.commit()

    r = _run()
    assert any(x["name"] == "DeadSearch" for x in r["searches"])
    assert r["count"] == len(r["companies"]) + len(r["searches"])
