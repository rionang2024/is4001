def by_time(rows):
    return {r["timestamp"][-5:]: r for r in rows}


def test_series_reproduces_incident(client):
    r = client.get("/api/series", params={"floor": 1, "zone": 2, "end_use": "AC", "date": "2018-10-03",
                                          "start": "20:25", "end": "20:48"})
    assert r.status_code == 200
    body = r.json()
    rows = by_time(body["rows"])
    assert body["count"] == 24 and not body["truncated"]
    assert rows["20:31"]["status"] == "amber"
    assert rows["20:35"]["status"] == "red"
    assert rows["20:44"]["status"] == "green"
    stamps = [x["timestamp"] for x in body["rows"]]
    assert stamps == sorted(stamps)  # sorted even though the file was shuffled
    assert body["rows"][0]["timestamp"] == "2018-10-03T20:25"  # local time, no timezone


def test_series_keeps_gaps_and_nulls(client):
    body = client.get("/api/series", params={"floor": 1, "zone": 2, "end_use": "AC", "date": "2018-10-03",
                                             "start": "11:58", "end": "12:03"}).json()
    rows = by_time(body["rows"])
    assert rows["12:00"]["power_kw"] is None and rows["12:00"]["status"] == "missing"  # null, never 0
    assert "12:01" not in rows  # absent minute stays absent
    assert body["count"] == 5


def test_series_caps_rows(client, monkeypatch):
    import app as qa_app
    monkeypatch.setattr(qa_app, "MAX_ROWS", 10)
    body = client.get("/api/series", params={"floor": 1, "zone": 2, "end_use": "AC", "date": "2018-10-03"}).json()
    assert body["count"] == 10 and body["truncated"] is True and body["max_rows"] == 10


def test_series_validates_input(client):
    base = {"floor": 1, "zone": 2, "date": "2018-10-03"}
    assert client.get("/api/series", params={**base, "end_use": "Heating"}).status_code == 422
    assert client.get("/api/series", params={**base, "start": "25:00"}).status_code == 422
    assert client.get("/api/series", params={**base, "date": "03/10/2018"}).status_code == 422
    assert client.get("/api/series", params={**base, "start": "10:00", "end": "09:00"}).status_code == 422
    assert client.get("/api/series", params={**base, "floor": 9}).status_code == 422


def test_snapshot_one_minute(client):
    body = client.get("/api/snapshot", params={"timestamp": "2018-10-03T20:35", "floor": 1}).json()
    ac = [r for r in body["rows"] if r["end_use"] == "AC"]
    assert len(ac) == 1 and ac[0]["zone"] == 2 and ac[0]["status"] == "red"
    assert {r["floor"] for r in body["rows"]} == {1}
    whole = client.get("/api/snapshot", params={"timestamp": "2018-10-03T20:35"}).json()
    assert {r["floor"] for r in whole["rows"]} == {1, 2}
    zone2 = [r for r in whole["rows"] if r["floor"] == 2 and r["zone"] == 2][0]
    assert zone2["power_kw"] is None  # missing stays null


def test_snapshot_neutral_is_reported_as_neutral(client):
    rows = client.get("/api/snapshot", params={"timestamp": "2018-10-03T03:00", "floor": 1}).json()["rows"]
    z1 = [r for r in rows if r["zone"] == 1 and r["end_use"] == "Lighting"][0]
    assert z1["status"] == "neutral" and z1["status_reason"] == "outside_alert_scope"


def test_compare_sums_zones_and_refuses_partial_totals(client):
    body = client.get("/api/compare", params={"floors": "1,2", "end_use": "AC", "date": "2018-10-03",
                                              "start": "20:34", "end": "20:36"}).json()
    f1, f2 = by_time(body["floors"]["1"]), by_time(body["floors"]["2"])
    assert f1["20:35"]["power_kw"] == 85.0
    assert f2["20:34"]["power_kw"] == 7.0
    assert f2["20:35"]["power_kw"] is None  # one zone missing -> no total, not a partial sum


def test_meta(client):
    body = client.get("/api/meta").json()
    assert body["floors"] == [1, 2]
    assert body["zones"]["1"]["2"] == ["AC", "Lighting"]
    assert body["date_min"] == "2018-10-03" and body["date_max"] == "2018-10-03"
