"""The alert rules: p99 is the stored status untouched, sd restates it (see rules.py)."""


def test_default_is_p99_without_rule_files(client):
    meta = client.get("/api/meta").json()
    assert meta["rules"]["default"] == "p99" and "sd" not in meta["rules"]
    assert client.get("/api/series", params={"floor": 1, "zone": 2, "end_use": "AC", "date": "2018-10-03", "start": "20:35", "end": "20:35"}
                      ).json()["rows"][0]["status"] == "red"


def test_asking_for_sd_without_files_is_an_error(client):
    r = client.get("/api/snapshot", params={"timestamp": "2018-10-03T20:35", "rule": "sd"})
    assert r.status_code == 503
    assert client.get("/api/snapshot", params={"timestamp": "2018-10-03T20:35", "rule": "nope"}).status_code == 422


def test_p99_can_always_be_asked_for(sd_client):
    body = sd_client.get("/api/series", params={"floor": 1, "zone": 2, "end_use": "AC", "date": "2018-10-03",
                                                 "start": "20:35", "end": "20:35", "rule": "p99"}).json()
    assert body["rule"] == "p99" and body["rows"][0]["status"] == "red" and body["rows"][0]["upper_threshold_kw"] == 51.2


def test_sd_is_the_default_when_its_files_exist(sd_client):
    meta = sd_client.get("/api/meta").json()["rules"]
    assert meta["default"] == "sd" and meta["sd"]["red_min"] == 5
    assert sd_client.get("/api/snapshot", params={"timestamp": "2018-10-03T20:35"}).json()["rule"] == "sd"


def test_sd_restates_status_threshold_and_duration(sd_client):
    body = sd_client.get("/api/series", params={"floor": 1, "zone": 2, "end_use": "AC", "date": "2018-10-03",
                                                 "start": "20:25", "end": "20:48", "rule": "sd"}).json()
    rows = {r["timestamp"][-5:]: r for r in body["rows"]}
    assert rows["20:30"]["status"] == "green" and rows["20:30"]["upper_threshold_kw"] == 49.0
    assert (rows["20:31"]["status"], rows["20:31"]["exceedance_duration_minutes"]) == ("amber", 1)
    assert (rows["20:35"]["status"], rows["20:35"]["exceedance_duration_minutes"]) == ("red", 5)
    assert rows["20:35"]["status_reason"] == "above_threshold_red"
    assert rows["20:44"]["status"] == "green"


def test_sd_run_that_began_before_the_window_comes_from_the_episode_table(sd_client):
    # the run starts at 20:31; a window starting at 20:40 only reads back to 20:36, so the 5 earlier minutes come from the episodes
    body = sd_client.get("/api/series", params={"floor": 1, "zone": 2, "end_use": "AC", "date": "2018-10-03",
                                                 "start": "20:40", "end": "20:45", "rule": "sd"}).json()
    rows = {r["timestamp"][-5:]: r for r in body["rows"]}
    assert (rows["20:40"]["status"], rows["20:40"]["exceedance_duration_minutes"]) == ("red", 10)
    assert rows["20:43"]["exceedance_duration_minutes"] == 13 and rows["20:44"]["status"] == "green"


def test_sd_snapshot_and_all_rows(sd_client):
    rows = sd_client.get("/api/snapshot", params={"timestamp": "2018-10-03T20:35", "rule": "sd"}).json()["rows"]
    by = {(r["floor"], r["zone"], r["end_use"]): r for r in rows}
    assert by[(1, 2, "AC")]["status"] == "red" and by[(1, 2, "AC")]["red_min"] == 5
    assert by[(1, 2, "Lighting")]["status"] == "green"          # no reference for it: keeps its stored status
    assert by[(1, 1, "Lighting")]["status"] == "neutral"        # out of scope: untouched
    # the default stored rule reports its own red_min
    old = sd_client.get("/api/snapshot", params={"timestamp": "2018-10-03T20:35", "rule": "p99"}).json()["rows"][0]
    assert old["red_min"] == 5
