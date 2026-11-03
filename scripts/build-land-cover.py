"""Build a conservative, independent land-cover overlay from ESA WorldCover.

Optional offline preparation only; the website needs no Python/GIS dependencies.
Requires numpy, rasterio, scipy, shapely >= 2.1. No commercial imagery is used.
Run: python scripts/build-land-cover.py [--refresh]
Source subsets are cached in ignored work/land-cover; GeoJSON is the source asset.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import geometry_mask, shapes
from rasterio.warp import transform as transform_xy
from rasterio.windows import from_bounds
from scipy import ndimage
import shapely
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "work/land-cover"
SOURCES = {
    2021: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N18E108_Map.tif",
    2020: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v100/2020/map/ESA_WorldCover_10m_2020_v100_N18E108_Map.tif",
}
# These are evidence filters, not a claim of calibrated probability or accuracy.
CLASSES = {
    10: ("forest", "树木覆盖", 6, 5),
    20: ("shrubland", "灌木", 6, 5),
    30: ("grassland", "草地", 8, 5),
    40: ("cropland", "耕地", 6, 5),
    60: ("bare_open", "裸地 / 稀疏植被", 6, 5),
    80: ("inland_water", "内陆水面", 2, 2),
    90: ("wetland", "草本湿地", 6, 5),
    95: ("mangrove", "红树林", 6, 5),
}
ATTRIBUTION = "© ESA WorldCover project 2020–2021 / Contains modified Copernicus Sentinel data (2020–2021) processed by ESA WorldCover consortium"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def transformer(source, target):
    def convert(x, y, z=None):
        return transform_xy(source, target, x, y)
    return convert


TO_METRES = transformer("EPSG:4326", "EPSG:32649")


def polygons(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    return [p for part in geom.geoms for p in polygons(part)]


def subset(year, bbox, refresh):
    path = CACHE / f"worldcover-{year}-naozhou.tif"
    if refresh or not path.exists():
        # COG range reads retrieve only the requested region, not a whole 3° tile.
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_TIMEOUT="30", GDAL_HTTP_MAX_RETRY="1"):
            with rasterio.open(SOURCES[year]) as source:
                window = from_bounds(*bbox, source.transform).round_offsets().round_lengths()
                pixels = source.read(1, window=window)
                profile = source.profile.copy()
                profile.update(width=pixels.shape[1], height=pixels.shape[0], transform=source.window_transform(window), compress="deflate", tiled=False, blockxsize=pixels.shape[1], blockysize=1)
                with rasterio.open(path, "w", **profile) as target:
                    target.write(pixels, 1)
                    target.update_tags(source_url=SOURCES[year], year=str(year))
    with rasterio.open(path) as source:
        if source.crs.to_epsg() != 4326:
            raise ValueError("WorldCover must be geographic WGS84, never GCJ-02.")
        pixels, affine = source.read(1), source.transform
        info = {"year": year, "version": "v200" if year == 2021 else "v100", "url": SOURCES[year], "subsetSha256": sha256(path), "subsetBounds": list(source.bounds), "resolutionDegrees": list(source.res)}
        return pixels, affine, info


def clean_class(mask, minimum):
    labels, count = ndimage.label(mask)  # 4-connectivity avoids diagonal bridges.
    counts = np.bincount(labels.ravel())
    keep = counts >= minimum
    keep[0] = False
    return keep[labels]


def round_coordinates(value):
    if isinstance(value, (list, tuple)):
        return [round_coordinates(x) for x in value]
    return round(float(value), 7)


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--refresh", action="store_true", help="Re-download only the ESA COG subsets.")
    refresh = args.parse_args().refresh
    CACHE.mkdir(parents=True, exist_ok=True)
    base_path = ROOT / "assets/vector-map-data.json"
    base = read_json(base_path)
    island = Polygon(base["coastline"])
    if not island.is_valid:
        raise ValueError("Do not repair or rewrite the authoritative coastline in this task.")
    west, south, east, north = island.bounds
    bbox = (math.floor((west-.002)*1000)/1000, math.floor((south-.002)*1000)/1000, math.ceil((east+.002)*1000)/1000, math.ceil((north+.002)*1000)/1000)
    current, affine, source21 = subset(2021, bbox, refresh)
    previous, previous_affine, source20 = subset(2020, bbox, refresh)
    if current.shape != previous.shape or affine != previous_affine:
        raise ValueError("The two ESA classification grids must align exactly.")
    inside = geometry_mask([mapping(island)], current.shape, affine, invert=True)
    built_geometries = [shapely.make_valid(Polygon(area["coordinates"])) for area in base["residential"]]
    protected = geometry_mask([mapping(p) for p in built_geometries], current.shape, affine, invert=True, all_touched=True)
    island_m = transform(TO_METRES, island)
    built = unary_union(built_geometries).intersection(island)
    built_m = transform(TO_METRES, built)
    permitted = island.difference(built)
    pixel_width = 111320*math.cos(math.radians((south+north)/2))*abs(affine.a)
    pixel_height = 111320*abs(affine.e)
    pixel_metres = math.sqrt(pixel_width*pixel_height)
    def pixel_to_wgs84(x, y, z=None):
        return affine.a*np.asarray(x)+affine.c, affine.e*np.asarray(y)+affine.f

    # A sea-connected classified water patch cannot become an invented inland lake.
    water_components, _ = ndimage.label(current == 80)
    marine_ids = np.unique(water_components[~inside])
    marine = np.isin(water_components, marine_ids[marine_ids != 0])
    filtered = np.zeros(current.shape, dtype=np.uint8)
    raw_counts = {}
    for code, (key, label, minimum, support) in CLASSES.items():
        neighbourhood = ndimage.convolve((current == code).astype(np.uint8), np.ones((3, 3), dtype=np.uint8), mode="constant")
        candidate = (current == code) & (previous == code) & (neighbourhood >= support) & inside & ~protected
        if code == 80:
            candidate &= ~marine
        accepted = clean_class(candidate, minimum)
        filtered[accepted] = code
        raw_counts[key] = {"source2021Pixels": int(((current == code) & inside & ~protected).sum()), "retainedPixels": int(accepted.sum()), "minimumConnectedPixels": minimum, "minimumSameClassNeighboursOf9": support}

    geometries, codes = [], []
    # Simplify the integer source grid before reprojection. Projecting separately
    # reduced collinear rings first can create tiny, false shared-edge mismatches.
    for geo, code in shapes(filtered, mask=filtered > 0, connectivity=4):
        # Raster polygonization drops collinear vertices independently. Restore
        # pixel-edge nodes so adjacent polygons have exactly matching edges.
        polygon = shapely.segmentize(shape(geo), max_segment_length=1)
        if not polygon.is_valid:
            raise ValueError("Unexpected invalid raster polygon; keep source data untouched.")
        geometries.append(polygon)
        codes.append(int(code))
    if not shapely.coverage_is_valid(geometries):
        raise ValueError("Classification polygons must have edge-matched, non-overlapping topology.")

    generated = {}
    level_stats = {}
    for level, tolerance in [("detail", 8), ("overview", 18)]:
        simplified = shapely.coverage_simplify(geometries, tolerance=tolerance/pixel_metres)
        by_class = {code: [] for code in CLASSES}
        for geom, code in zip(simplified, codes):
            # Clip after simplifying as well; neither coast nor confirmed built areas move.
            by_class[code].extend(polygons(transform(pixel_to_wgs84, geom).intersection(permitted)))
        features, stats, coverage = [], {}, []
        for code, parts in by_class.items():
            if not parts:
                continue
            geom = unary_union(parts)
            if not geom.is_valid or geom.is_empty:
                raise ValueError("Invalid simplified land-cover geometry.")
            coverage.append(geom)
            key, label, _, _ = CLASSES[code]
            wgs84 = geom
            if wgs84.geom_type == "Polygon":
                wgs84 = MultiPolygon([wgs84])
            geo = mapping(wgs84)
            geo["coordinates"] = round_coordinates(geo["coordinates"])
            # Quantization can move a coastline intersection by centimetres.
            # Reapply the exact exclusion after rounding, without moving base data.
            final = shape(geo).intersection(permitted)
            if not final.is_valid:
                raise ValueError("Invalid quantized output geometry.")
            final_parts = polygons(final)
            if not final_parts:
                raise ValueError("A real cover class must not disappear during serialization.")
            geo = mapping(MultiPolygon(final_parts))
            features.append({"type": "Feature", "id": f"esa2021-{key}-{level}", "properties": {"class": key, "label": label, "sourceClass": code, "observedYear": 2021, "status": "remote_sensing_reference", "lod": level}, "geometry": geo})
            stats[key] = {"areaKm2": round(transform(TO_METRES, geom).area/1e6, 4), "polygonCount": len(polygons(geom))}
        covered = unary_union(coverage)
        if covered.area < sum(p.area for p in coverage)-1e-12:
            raise ValueError("Simplification introduced overlapping cover classes.")
        if covered.intersection(built).area > 1e-12 or covered.difference(island).area > 1e-12:
            raise ValueError("The new overlay must not cover protected built areas or leave the island.")
        generated[level] = {"type": "FeatureCollection", "features": features}
        level_stats[level] = {"classes": stats, "unknownAreaKm2": round(transform(TO_METRES, permitted.difference(covered)).area/1e6, 4), "simplificationMetres": tolerance}

    metadata = {
        "id": "naozhou-worldcover-2021-reference", "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(), "observationYear": 2021,
        "coordinateSystem": "WGS84", "storageCrs": "EPSG:4326", "processingCrs": "Native WorldCover grid for shared-edge simplification; EPSG:4326 for clipping", "areaMeasurementCrs": "EPSG:32649", "displayProjection": "EPSG:3857 (existing map local origin)",
        "nominalResolutionMetres": 10, "bbox": list(island.bounds), "sourceOverview": "ESA WorldCover 2021 v200; conservative agreement with 2020 v100",
        "sources": [source21, source20], "documentation": "https://esa-worldcover.org/en/data-access", "productManual": "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf",
        "license": {"name": "CC BY 4.0", "url": "https://creativecommons.org/licenses/by/4.0/", "attribution": ATTRIBUTION},
        "method": {"filter": "Same class in both annual products, same-class 3x3 neighbourhood support, and 4-connected patch thresholds; filters only remove unsupported cells, never grow them.", "confidence": "Conservative cross-product agreement, NOT a pixel probability or a measured local accuracy. The two versions use different algorithms; disagreement is not interpreted as land-cover change.", "geometry": "Raster polygonization, topology-preserving shared-edge simplification, exact coastline clipping and confirmed settlement subtraction; water is retained at both detail levels.", "builtUp": "Do not import WorldCover class 50. Existing project settlements remain authoritative; unmatched remote built-up classifications remain unknown.", "water": "Exclude sea-connected patches and require both annual products to agree; small accepted water patches are retained. Inland water can include ponds/reservoirs and is not asserted to be a named or currently permanent lake."},
        "limitations": ["Historical 2021 land-cover reference, not a current or cadastral survey.", "Tree cover includes plantations and perennial woody crops; it does not prove natural forest or land tenure.", "Annual classification can confuse seasonal crops, grass, bare ground and small/mixed water bodies; excluded or disputed areas remain unknown.", "Dynamic World was assessed but was not read: no configured Earth Engine authorization (public API requires authentication). No probability data or newer validation is claimed.", "No Amap imagery, commercial tiles or legacy woodland polygons were used."],
        "protectedBase": {"path": "assets/vector-map-data.json", "sha256": sha256(base_path), "coastlineVertices": len(base["coastline"]), "settlementPolygons": len(base["residential"]), "roadFeatures": len(base["roads"]), "placeCount": len(base["places"])},
        "statistics": {"islandAreaKm2": round(island_m.area/1e6, 4), "existingBuiltAreaKm2": round(built_m.area/1e6, 4), "sourcePixelCounts": raw_counts, "levels": level_stats},
        "software": {"rasterio": rasterio.__version__, "shapely": shapely.__version__, "numpy": np.__version__},
    }
    for level, dataset in generated.items():
        dataset["metadata"] = metadata
        suffix = "" if level == "detail" else "-overview"
        target = ROOT / f"assets/land-cover{suffix}.geojson"
        target.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"statistics": metadata["statistics"], "files": {level: len(json.dumps(data, ensure_ascii=False)) for level, data in generated.items()}}, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
