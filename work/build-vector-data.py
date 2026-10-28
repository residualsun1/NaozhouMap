"""Package open geographic data for the offline SVG map. Never reads Google tiles."""
import json
import math
from collections import Counter
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
coast = json.loads((ROOT / 'assets/island-outline.json').read_text(encoding='utf-8'))
island = coast[0]


def point_in_ring(point, ring=island):
    """Ray casting, including points on the coastline."""
    x, y = point
    inside = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
        if abs(cross) < 1e-12 and min(a[0], b[0]) <= x <= max(a[0], b[0]) and min(a[1], b[1]) <= y <= max(a[1], b[1]):
            return True
        if (a[1] > y) != (b[1] > y) and x < a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]):
            inside = not inside
    return inside


def segments_intersect(a, b, c, d):
    if max(a[0], b[0]) < min(c[0], d[0]) or max(c[0], d[0]) < min(a[0], b[0]) or max(a[1], b[1]) < min(c[1], d[1]) or max(c[1], d[1]) < min(a[1], b[1]):
        return False
    def side(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    return side(a, b, c) * side(a, b, d) <= 0 and side(c, d, a) * side(c, d, b) <= 0


def intersects_island(coords):
    # Retain crossing geometry whole; the SVG coastline clip hides offshore parts.
    if any(point_in_ring(p) for p in coords):
        return True
    if any(segments_intersect(a, b, c, d) for a, b in zip(coords, coords[1:]) for c, d in zip(island, island[1:])):
        return True
    return coords[0] == coords[-1] and point_in_ring(island[0], coords)


places = json.loads((ROOT / 'assets/reference-places.json').read_text(encoding='utf-8'))
raw_path = ROOT / 'work/osm-vector-raw.json'
raw = json.loads(raw_path.read_text(encoding='utf-8')) if raw_path.exists() else {'elements': []}
elements = raw.get('elements', [])
nodes = {e['id']: [e['lon'], e['lat']] for e in elements if e['type'] == 'node'}
roads, waters, buildings, residential = [], [], [], []
for e in elements:
    tags = e.get('tags', {})
    if e['type'] == 'way':
        coords = [[p['lon'], p['lat']] for p in e.get('geometry', [])]
        if not coords:
            coords = [nodes[n] for n in e.get('nodes', []) if n in nodes]
        if len(coords) < 2 or not intersects_island(coords):
            continue
        item = {'id': e['id'], 'coordinates': coords, 'name': tags.get('name') or tags.get('ref', ''), 'type': tags.get('highway', '')}
        item.update({key: tags[key] for key in ['ref', 'highway', 'lanes', 'oneway', 'surface', 'width'] if tags.get(key)})
        if tags.get('highway') and tags.get('area') != 'yes': roads.append(item)
        elif tags.get('waterway') or tags.get('natural') == 'water': waters.append(item)
        elif tags.get('building') or tags.get('building:part'): buildings.append(item)
        elif tags.get('landuse') == 'residential': residential.append(item)
    if e['type'] == 'node' and tags.get('place') in {'village','hamlet','neighbourhood','suburb','town','locality'} and (tags.get('name:zh') or tags.get('name')):
        name = tags.get('name:zh') or tags['name']
        existing = next((p for p in places if p['name'].removesuffix('村') == name.removesuffix('村') or p.get('osmId') == str(e['id'])), None)
        if existing:
            existing['previousLocation'] = {'lat': existing['lat'], 'lng': existing['lng'], 'source': 'GeoNames'}
            existing.update({'lat': e['lat'], 'lng': e['lon'], 'name': name, 'nameSource': 'OpenStreetMap', 'coordinateSource': 'OpenStreetMap', 'osmId': str(e['id']), 'sourceUrl': 'https://www.openstreetmap.org/node/'+str(e['id'])})
        else:
            places.append({'id': 'osm-'+str(e['id']), 'name': name, 'lat': e['lat'], 'lng': e['lon'], 'nameSource': 'OpenStreetMap', 'coordinateSource': 'OpenStreetMap', 'sourceUrl': 'https://www.openstreetmap.org/node/'+str(e['id'])})
for p in places:
    p.setdefault('coordinateSource', 'GeoNames')
    p.setdefault('sourceUrl', 'https://www.geonames.org/'+p['id']+'/')

# Supplemental built areas retain their own source and survive OSM refreshes.
settlement_additions_path = ROOT / 'assets/settlement-additions.json'
supplemental_areas = []
if settlement_additions_path.exists():
    supplemental_areas = json.loads(settlement_additions_path.read_text(encoding='utf-8'))
    # An interpreted replacement explicitly retires only its named base areas.
    # Keep the raw OSM source intact so this decision survives later rebuilds.
    replacement_ids = {str(area_id) for area in supplemental_areas for area_id in area.get('replacesAreaIds', [])}
    residential = [area for area in residential if str(area['id']) not in replacement_ids]
    known_area_ids = {str(area['id']) for area in residential}
    for area in supplemental_areas:
        coords = area.get('coordinates', [])
        if area.get('coordinateSystem') != 'WGS84' or not area.get('sourceUrl') or not area.get('sourceDescription'):
            raise ValueError('Supplemental built area needs WGS84 coordinates and source information.')
        if len(coords) < 4 or coords[0] != coords[-1] or any(len(p) != 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in p) or not point_in_ring(p) for p in coords):
            raise ValueError('Supplemental built area must be a closed ring inside the island.')
        if not area.get('id') or str(area['id']) in known_area_ids:
            raise ValueError('Duplicate or missing supplemental built area id.')
        known_area_ids.add(str(area['id']))
        residential.append(dict(area))

# Add checked reference records by stable id, then apply position corrections.
additions_path = ROOT / 'assets/reference-additions.json'
if additions_path.exists():
    for addition in json.loads(additions_path.read_text(encoding='utf-8')):
        existing = next((p for p in places if p['id'] == addition['id']), None)
        if existing is None:
            places.append(dict(addition))
        else:
            existing.update(addition)

# Keep checked reference corrections when rebuilding the public basemap.
corrections_path = ROOT / 'assets/reference-corrections.json'
if corrections_path.exists():
    for correction in json.loads(corrections_path.read_text(encoding='utf-8')):
        place = next((p for p in places if p['id'] == correction['id']), None)
        if place is None:
            place = dict(correction)
            place.setdefault('name', correction.get('sourceLocation', {}).get('name'))
            if not place.get('name'):
                raise ValueError('New reference correction needs name: ' + correction['id'])
            places.append(place)
        else:
            place['previousLocation'] = {
                'lat': place['lat'], 'lng': place['lng'],
                'source': place.get('coordinateSource'), 'sourceUrl': place.get('sourceUrl')
            }
            place.update(correction)

places = [p for p in places if point_in_ring([p['lng'], p['lat']])]

# A user-confirmed display merge keeps the complete alternate reference as source data.
references_by_id = {p['id']: p for p in places}
for place in places:
    target_id = place.get('displayMergedInto')
    if not target_id:
        continue
    target = references_by_id[target_id]
    if target is place or target.get('displayMergedInto'):
        raise ValueError('Display merges must point directly to a distinct retained reference.')
    target['aliases'] = list(dict.fromkeys(target.get('aliases', []) + [place['name']] + place.get('aliases', [])))
    target.setdefault('mergedReferences', []).append(dict(place))
places = [p for p in places if not p.get('displayMergedInto')]

def convex_hull(points):
    points = sorted(set(points))
    def cross(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    lower, upper = [], []
    for p in points:
        while len(lower) > 1 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(points):
        while len(upper) > 1 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


# Membership and illustrative coverage are independent of provider POI categories.
administrative_areas = []
administrative_path = ROOT / 'assets/administrative-areas.json'
if administrative_path.exists():
    by_id = {p['id']: p for p in places}
    assigned_places, area_ids = set(), set()
    for area in json.loads(administrative_path.read_text(encoding='utf-8')):
        office = by_id[area['officePlaceId']] if area.get('officePlaceId') else None
        member_specs = area['memberVillages']
        member_specs_by_id = {m['placeId']: m for m in member_specs}
        members = [by_id[m['placeId']] for m in member_specs]
        member_kinds = {m['placeId']: m.get('placeKind', 'natural_village') for m in member_specs}
        if any(kind not in {'natural_village', 'locality'} for kind in member_kinds.values()):
            raise ValueError('Unsupported administrative member type.')
        member_ids = {p['id'] for p in members}
        if len(member_ids) != len(members) or office and office['id'] in member_ids:
            raise ValueError('Administrative seat and member places must be distinct.')
        for member in member_specs:
            parent_id = member.get('parentVillageId')
            if parent_id is not None and (not isinstance(parent_id, str) or member_kinds[member['placeId']] != 'locality'
                    or parent_id == member['placeId'] or parent_id not in member_ids
                    or member_kinds[parent_id] != 'natural_village'):
                raise ValueError('A settlement part needs a distinct parent village in the same administrative area.')
        area_places = member_ids | ({office['id']} if office else set())
        if area['id'] in area_ids or assigned_places & area_places:
            raise ValueError('Duplicate administrative area or conflicting village membership.')
        area_ids.add(area['id'])
        assigned_places.update(area_places)
        for p in ([office] if office else []) + members:
            p.update(administrativeAreaId=area['id'], committeeName=area['committeeName'])
            if area.get('administrativeType') == 'community':
                p['administrativeCommunityName'] = area['name']
            else:
                p['administrativeVillageName'] = area['name']
            p['placeKind'] = 'administrative_seat' if p is office else member_kinds[p['id']]
            p['classificationSource'] = member_specs_by_id.get(p['id'], {}).get('classificationSource', area['classificationSource'])
            parent_id = member_specs_by_id.get(p['id'], {}).get('parentVillageId')
            if parent_id is not None:
                p.update(parentVillageId=parent_id, parentVillageName=by_id[parent_id]['name'])
        if office and area.get('officeCaption'):
            office['administrativeCaption'] = area['officeCaption']
        if office:
            office['aliases'] = list(dict.fromkeys(office.get('aliases', []) + [area['committeeName'], area['committeeName']+'驻地']))
        coverage = area['coverage']
        if coverage['status'] != 'illustrative' or not coverage['landOnly']:
            raise ValueError('This data source only supports illustrative land coverage.')
        coverage_places = members + [office] if office and coverage.get('includeOffice') else members
        earth = 6378137
        latitude = sum(p['lat'] for p in coverage_places) / len(coverage_places)
        radius = coverage['bufferMeters'] / math.cos(math.radians(latitude))
        samples = []
        for p in coverage_places:
            x = earth * math.radians(p['lng'])
            y = earth * math.log(math.tan(math.pi/4 + math.radians(p['lat'])/2))
            samples.extend((x+radius*math.cos(i*math.pi/8), y+radius*math.sin(i*math.pi/8)) for i in range(16))
        hull = convex_hull(samples)
        coords = [[round(math.degrees(x/earth), 7), round(math.degrees(2*math.atan(math.exp(y/earth))-math.pi/2), 7)] for x, y in hull]
        coords.append(coords[0])
        administrative_areas.append({**area, 'coordinates': coords,
            'labelAnchor': [sum(p['lng'] for p in coverage_places)/len(coverage_places), latitude],
            'clipToIsland': True})

data = {'coastline': island, 'roads': roads, 'waters': waters, 'buildings': buildings, 'residential': residential, 'places': places, 'administrativeAreas': administrative_areas,
        'meta': {'generatedAt': datetime.now(timezone.utc).isoformat(), 'coordinateSystem': 'WGS84', 'coastlineSource': 'https://www.openstreetmap.org/relation/11276723', 'osmTimestamp': raw.get('osm3s', {}).get('timestamp_osm_base'), 'completeVillageList': False,
                 'scope': '硇洲岛主岛：参考点限于岛内，跨岸线几何由 SVG 裁剪',
                 'roadTypeCounts': dict(Counter(r['type'] for r in roads)),
                 'settlementAreaSource': 'OpenStreetMap landuse=residential' + ('；补充轮廓：高德卫星影像人工判读' if supplemental_areas else ''),
                 'settlementAreaMeaning': '聚落阴影表示公开住宅用地或近似建成区，不代表村界或逐栋建筑轮廓。',
                 'supplementalSettlementAreaCount': len(supplemental_areas),
                 'buildingFootprintCount': len(buildings),
                 'buildingFootprintNote': '当前公开数据没有独立建筑轮廓。' if not buildings else '仅显示公开数据已收录的建筑轮廓。',
                 'licenses': [{'source': 'OpenStreetMap contributors', 'license': 'ODbL 1.0', 'url': 'https://www.openstreetmap.org/copyright'}, {'source': 'GeoNames', 'license': 'CC BY 4.0', 'url': 'https://www.geonames.org/export/'}]}}
(ROOT / 'map-data.js').write_text('window.NAOZHOU_DATA = '+json.dumps(data, ensure_ascii=False, separators=(',', ':'))+';\n', encoding='utf-8')
(ROOT / 'assets/vector-map-data.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(json.dumps({k:len(data[k]) for k in ['coastline','roads','waters','buildings','residential','places']}, ensure_ascii=False))
