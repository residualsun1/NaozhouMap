"""Derive display-only overview/regional maps from the existing detail GeoJSON.

No imagery, download, reclassification or changes to the detail dataset.
Run: python scripts/generalize_land_cover.py
Uses the project's existing shapely/rasterio offline processing environment.
"""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import shapely
from shapely.geometry import Polygon, MultiPolygon, shape, mapping
from shapely.ops import transform, unary_union
from rasterio.warp import transform as warp

ROOT = Path(__file__).resolve().parents[1]
PROTECTED = {"inland_water", "wetland", "mangrove"}
ORDER = ["cropland", "forest", "grassland", "bare_open"]
SETTINGS = {
    "overview": {
        "minimumAreaM2": {"forest": 4000, "cropland": 1200, "grassland": 2500, "bare_open": 2000},
        "smallHoleAreaM2": {"forest": 6000, "cropland": 750, "grassland": 1000, "bare_open": 1000},
        "gapMetres": {"forest": 30, "cropland": 10, "grassland": 12, "bare_open": 12},
        "smoothingMetres": {"forest": 35, "cropland": 3, "grassland": 8, "bare_open": 8},
        "simplificationMetres": 20, "settlementClearanceMetres": 10, "maxAddedAreaRatio": .06,
    },
    "regional": {
        "minimumAreaM2": {"forest": 1200, "cropland": 400, "grassland": 900, "bare_open": 700},
        "smallHoleAreaM2": {"forest": 700, "cropland": 250, "grassland": 300, "bare_open": 300},
        "gapMetres": {"forest": 8, "cropland": 6, "grassland": 5, "bare_open": 5},
        "smoothingMetres": {"forest": 10, "cropland": 1.5, "grassland": 2, "bare_open": 2},
        "simplificationMetres": 5, "settlementClearanceMetres": 3, "maxAddedAreaRatio": .025,
    },
}


def project(source, target):
    return lambda x, y, z=None: warp(source, target, x, y)


TO_M = project("EPSG:4326", "EPSG:32649")
TO_WGS = project("EPSG:32649", "EPSG:4326")


def parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    return [p for g in geometry.geoms for p in parts(g)]


def measure(geometry):
    polygons = parts(geometry)
    return {"areaKm2": round(geometry.area / 1e6, 4), "polygonCount": len(polygons), "holeCount": sum(len(p.interiors) for p in polygons)}


def limited_growth(candidate, original, ratio):
    """Bound display expansion; never turn a large unknown tract into a class."""
    budget = original.area * ratio
    additions = []
    for polygon in sorted(parts(candidate.difference(original)), key=lambda p: p.area):
        if polygon.area <= budget:
            additions.append(polygon)
            budget -= polygon.area
    return unary_union([candidate.intersection(original), *additions])


def cartographic_shape(seed, settings, kind):
    # Close tiny enclosed holes first. Other retained classes are excluded below.
    threshold = settings["smallHoleAreaM2"][kind]
    filled = unary_union([Polygon(p.exterior, [ring for ring in p.interiors if Polygon(ring).area > threshold]) for p in parts(seed)])
    radius = settings["gapMetres"][kind]
    closed = filled.buffer(radius, quad_segs=3).buffer(-radius, quad_segs=3)
    # Only bridge short, small gaps. Large unclassified areas stay neutral.
    bridges = [p for p in parts(closed.difference(filled)) if p.area <= threshold * 2]
    combined = unary_union([filled, *bridges])
    smoothing = settings["smoothingMetres"][kind]
    softened = combined.buffer(-smoothing, quad_segs=3).buffer(smoothing, quad_segs=3)
    return softened.simplify(settings["simplificationMetres"], preserve_topology=True)


def generalize_assets(root=ROOT):
    source_path = root / "assets/land-cover.geojson"
    original_bytes = source_path.read_bytes()
    source = json.loads(original_bytes)
    base = json.loads((root / "assets/vector-map-data.json").read_text(encoding="utf-8"))
    original = {f["properties"]["class"]: transform(TO_M, shape(f["geometry"])) for f in source["features"]}
    geographic = {f["properties"]["class"]: shape(f["geometry"]) for f in source["features"]}
    coast = Polygon(base["coastline"])
    coast_m = transform(TO_M, coast)
    built = unary_union([shapely.make_valid(Polygon(f["coordinates"])) for f in base["residential"]])
    built_m = transform(TO_M, built)
    important = unary_union([geographic[k] for k in PROTECTED if k in geographic])
    important_m = unary_union([original[k] for k in PROTECTED if k in original])
    datasets, statistics = {}, {}

    for level, settings in SETTINGS.items():
        minimum = settings["minimumAreaM2"]
        seeds = {k: unary_union([p for p in parts(g) if k in PROTECTED or p.area >= minimum.get(k, 0)]) for k, g in original.items()}
        permitted = coast_m.difference(built_m.buffer(settings["settlementClearanceMetres"])).difference(important_m)
        allocated = important
        output = {k: geographic[k] for k in PROTECTED if k in geographic}
        for kind in ORDER:
            if kind not in seeds or seeds[kind].is_empty:
                continue
            other_seeds = unary_union([g for k, g in seeds.items() if k != kind])
            candidate = cartographic_shape(seeds[kind], settings, kind)
            candidate = candidate.intersection(permitted).difference(other_seeds)
            candidate = limited_growth(candidate, original[kind], settings["maxAddedAreaRatio"])
            candidate = unary_union([p for p in parts(candidate) if p.area >= minimum[kind]])
            result = transform(TO_WGS, candidate).intersection(coast).difference(built).difference(allocated)
            result = shapely.make_valid(result)
            if result.is_empty:
                continue
            output[kind] = MultiPolygon(parts(result))
            allocated = unary_union([allocated, output[kind]])

        if allocated.difference(coast).area > 1e-12 or allocated.intersection(built).area > 1e-12:
            raise ValueError("Cartographic shapes must preserve the coastline and confirmed settlements.")
        if sum(g.area for g in output.values()) - allocated.area > 1e-12:
            raise ValueError("Cartographic classes must not overlap.")
        features, measures = [], {}
        for feature in source["features"]:
            kind = feature["properties"]["class"]
            if kind not in output:
                continue
            result = output[kind]
            if not result.is_valid:
                raise ValueError(f"Invalid {level} geometry: {kind}")
            item = deepcopy(feature)
            item["id"] = f"esa2021-{kind}-{level}"
            item["properties"].update(lod=level, cartographicGeneralization=kind not in PROTECTED)
            # Water/wetland/mangrove coordinates remain byte-for-byte equivalent.
            item["geometry"] = feature["geometry"] if kind in PROTECTED else mapping(result)
            features.append(item)
            measures[kind] = measure(transform(TO_M, result))
        if measures.get("forest", {}).get("areaKm2", 0) < original["forest"].area / 1e6 * .7:
            raise ValueError("Overview must retain the broad forest distribution, not just a few cores.")
        datasets[level] = {"type": "FeatureCollection", "features": features}
        statistics[level] = {"classes": measures, "unknownAreaKm2": round(transform(TO_M, coast.difference(built).difference(allocated)).area / 1e6, 4)}

    metadata = deepcopy(source["metadata"])
    metadata["statistics"]["levels"].update(statistics)
    metadata["cartography"] = {
        "version": 3, "derivedAt": datetime.now(timezone.utc).isoformat(),
        "sourceDetailSha256": hashlib.sha256(original_bytes).hexdigest(),
        "basis": "Existing detail GeoJSON only; no new imagery or classification. Original detail coordinates remain unchanged.",
        "method": "Scale-dependent minimum patches; small enclosed hole filling; bounded same-class gap closing; gentle opening and simplification. Retained other-class patches are reserved. New display area is capped and large unknown areas remain neutral.",
        "meaning": "Overview and regional boundaries are cartographic approximations, not new field-verified land-cover data. Small omitted patches return in the detail view.",
        "protectedClasses": sorted(PROTECTED), "settings": SETTINGS,
        "sourceStructure": {k: measure(g) for k, g in original.items()},
    }
    for level, dataset in datasets.items():
        dataset["metadata"] = metadata
        (root / f"assets/land-cover-{level}.geojson").write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if source_path.read_bytes() != original_bytes:
        raise ValueError("Detail source must not be rewritten by display generalization.")
    print(json.dumps({"cartographicLevels": statistics, "detailUnchanged": True}, ensure_ascii=True), flush=True)
    return metadata


if __name__ == "__main__":
    generalize_assets()
