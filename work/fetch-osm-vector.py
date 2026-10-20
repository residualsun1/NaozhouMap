"""Refresh the offline map's public OSM geometry; preserve the previous raw file.

Query deliberately contains roads, built areas, water, and place labels only.
No vegetation, woodland, or tree layer is requested.
"""
import json
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "work/osm-vector-raw.json"
BBOX = "20.865,110.548,20.953,110.640"  # south, west, north, east (WGS84)
QUERY = f"""[out:json][timeout:60];
(
  way[highway]({BBOX});
  relation[highway]({BBOX});
  way[building]({BBOX});
  relation[building]({BBOX});
  way[\"building:part\"]({BBOX});
  relation[\"building:part\"]({BBOX});
  way[landuse=residential]({BBOX});
  relation[landuse=residential]({BBOX});
  way[waterway]({BBOX});
  relation[waterway]({BBOX});
  way[natural=water]({BBOX});
  relation[natural=water]({BBOX});
  node[place~\"^(village|hamlet|neighbourhood|suburb|town|locality)$\"]({BBOX});
);
out body geom;"""

stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
backup = TARGET.with_name(f"osm-vector-raw-before-{stamp}.json")
if TARGET.exists():
    shutil.copy2(TARGET, backup)
body = urlencode({"data": QUERY}).encode("utf-8")
endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
errors = []
for endpoint in endpoints:
    try:
        request = Request(endpoint, data=body, headers={
            "User-Agent": "NaozhouMap-local-field-survey/1.0",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        })
        with urlopen(request, timeout=90) as response:
            raw_bytes = response.read()
        raw = json.loads(raw_bytes)
        if raw.get("remark") or not raw.get("elements"):
            raise ValueError(raw.get("remark", "No elements returned"))
        break
    except Exception as error:
        errors.append({"endpoint": endpoint, "error": str(error)})
        print(json.dumps(errors[-1]), flush=True)
else:
    raise RuntimeError("OSM refresh failed; original raw file remains unchanged")

TARGET.write_bytes(raw_bytes)
elements = raw["elements"]
counts = {}
for category, matches in {
    "roads": lambda t: t.get("highway") and t.get("area") != "yes",
    "buildings": lambda t: t.get("building") or t.get("building:part"),
    "residential": lambda t: t.get("landuse") == "residential",
    "water": lambda t: t.get("waterway") or t.get("natural") == "water",
    "places": lambda t: t.get("place"),
}.items():
    counts[category] = dict(Counter(e["type"] for e in elements if matches(e.get("tags", {}))))
roads = [e for e in elements if e["type"] == "way" and e.get("tags", {}).get("highway")]
note = {
    "retrievedAt": datetime.now(timezone.utc).isoformat(),
    "endpoint": endpoint,
    "sourceUrl": "https://www.openstreetmap.org/copyright",
    "license": "ODbL 1.0",
    "coordinateSystem": "WGS84",
    "bbox": BBOX,
    "osmTimestamp": raw.get("osm3s", {}).get("timestamp_osm_base"),
    "elements": len(elements),
    "counts": counts,
    "highwayTypes": dict(Counter(e["tags"]["highway"] for e in roads)),
    "roadTagCoverage": {key: sum(key in e["tags"] for e in roads) for key in ["name", "ref", "surface", "width", "lanes", "tracktype", "bridge", "tunnel"]},
    "rawBackup": str(backup.relative_to(ROOT)) if backup.exists() else None,
    "query": QUERY,
    "requestErrors": errors,
    "limitation": "OSM mapped features only. No inferred buildings; bbox is clipped to the main island when rendering.",
}
(ROOT / "work/osm-vector-acquisition.json").write_text(json.dumps(note, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({k: v for k, v in note.items() if k not in {"query"}}, ensure_ascii=False, indent=2))
