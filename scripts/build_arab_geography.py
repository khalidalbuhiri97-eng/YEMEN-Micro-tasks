#!/usr/bin/env python3
"""
Builds verified Arab League (22 countries) geographic & administrative divisions dataset
strictly from real open-source geospatial repositories:
  - GeoNames (https://download.geonames.org/export/dump/) [CC-BY 4.0]
  - UN OCHA HDX COD-AB (https://data.humdata.org/dataset/cod-ab-*) [CC BY-IGO]
  - Wikidata SPARQL (https://query.wikidata.org/sparql) [CC0 1.0]

Zero AI-fabricated divisions or guessed Arabic names. Every entry requires verified
Arabic and English labels from the source datasets above.
"""

import io
import json
import os
import re
import uuid
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone

NS = uuid.UUID("a3f19d40-7c2b-4e8a-9f12-202604010000")
AR_RE = re.compile(r"[\u0600-\u06FF]")
TASHKEEL_RE = re.compile(r"[\u064B-\u065F\u0670\u0640]")

NOW_ISO = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

GN_CACHE_DIR = "/tmp/geonames"
OCHA_CACHE_DIR = "/tmp/ocha"
WD_CACHE_PATH = "/tmp/wd_cache.json"

COUNTRIES_META = [
    {"iso2": "YE", "iso3": "YEM", "name_ar": "اليمن", "name_en": "Yemen", "flag": "🇾🇪", "phone": "+967", "order": 1},
    {"iso2": "SA", "iso3": "SAU", "name_ar": "السعودية", "name_en": "Saudi Arabia", "flag": "🇸🇦", "phone": "+966", "order": 2},
    {"iso2": "AE", "iso3": "ARE", "name_ar": "الإمارات", "name_en": "United Arab Emirates", "flag": "🇦🇪", "phone": "+971", "order": 3},
    {"iso2": "KW", "iso3": "KWT", "name_ar": "الكويت", "name_en": "Kuwait", "flag": "🇰🇼", "phone": "+965", "order": 4},
    {"iso2": "QA", "iso3": "QAT", "name_ar": "قطر", "name_en": "Qatar", "flag": "🇶🇦", "phone": "+974", "order": 5},
    {"iso2": "BH", "iso3": "BHR", "name_ar": "البحرين", "name_en": "Bahrain", "flag": "🇧🇭", "phone": "+973", "order": 6},
    {"iso2": "OM", "iso3": "OMN", "name_ar": "عُمان", "name_en": "Oman", "flag": "🇴🇲", "phone": "+968", "order": 7},
    {"iso2": "IQ", "iso3": "IRQ", "name_ar": "العراق", "name_en": "Iraq", "flag": "🇮🇶", "phone": "+964", "order": 8},
    {"iso2": "JO", "iso3": "JOR", "name_ar": "الأردن", "name_en": "Jordan", "flag": "🇯🇴", "phone": "+962", "order": 9},
    {"iso2": "PS", "iso3": "PSE", "name_ar": "فلسطين", "name_en": "Palestine", "flag": "🇵🇸", "phone": "+970", "order": 10},
    {"iso2": "SY", "iso3": "SYR", "name_ar": "سوريا", "name_en": "Syria", "flag": "🇸🇾", "phone": "+963", "order": 11},
    {"iso2": "LB", "iso3": "LBN", "name_ar": "لبنان", "name_en": "Lebanon", "flag": "🇱🇧", "phone": "+961", "order": 12},
    {"iso2": "EG", "iso3": "EGY", "name_ar": "مصر", "name_en": "Egypt", "flag": "🇪🇬", "phone": "+20", "order": 13},
    {"iso2": "SD", "iso3": "SDN", "name_ar": "السودان", "name_en": "Sudan", "flag": "🇸🇩", "phone": "+249", "order": 14},
    {"iso2": "LY", "iso3": "LBY", "name_ar": "ليبيا", "name_en": "Libya", "flag": "🇱🇾", "phone": "+218", "order": 15},
    {"iso2": "TN", "iso3": "TUN", "name_ar": "تونس", "name_en": "Tunisia", "flag": "🇹🇳", "phone": "+216", "order": 16},
    {"iso2": "DZ", "iso3": "DZA", "name_ar": "الجزائر", "name_en": "Algeria", "flag": "🇩🇿", "phone": "+213", "order": 17},
    {"iso2": "MA", "iso3": "MAR", "name_ar": "المغرب", "name_en": "Morocco", "flag": "🇲🇦", "phone": "+212", "order": 18},
    {"iso2": "MR", "iso3": "MRT", "name_ar": "موريتانيا", "name_en": "Mauritania", "flag": "🇲🇷", "phone": "+222", "order": 19},
    {"iso2": "SO", "iso3": "SOM", "name_ar": "الصومال", "name_en": "Somalia", "flag": "🇸🇴", "phone": "+252", "order": 20},
    {"iso2": "DJ", "iso3": "DJI", "name_ar": "جيبوتي", "name_en": "Djibouti", "flag": "🇩🇯", "phone": "+253", "order": 21},
    {"iso2": "KM", "iso3": "COM", "name_ar": "جزر القمر", "name_en": "Comoros", "flag": "🇰🇲", "phone": "+269", "order": 22},
]

# Country-specific official administrative level terminology
LEVEL_DEFS = {
    "YE": [
        (1, "governorate", "المحافظة", "Governorate", "المحافظات"),
        (2, "district", "المديرية", "District", "المديريات"),
    ],
    "SA": [
        (1, "region", "المنطقة الإدارية", "Administrative Region", "المناطق الإدارية"),
        (2, "governorate", "المحافظة", "Governorate", "المحافظات"),
    ],
    "AE": [
        (1, "emirate", "الإمارة", "Emirate", "الإمارات"),
        (2, "city_area", "المدينة / المنطقة", "City / Area", "المدن والمناطق"),
    ],
    "KW": [
        (1, "governorate", "المحافظة", "Governorate", "المحافظات"),
        (2, "area", "المنطقة", "Area", "المناطق"),
    ],
    "QA": [
        (1, "municipality", "البلدية", "Municipality", "البلديات"),
        (2, "zone", "المنطقة", "Zone", "المناطق"),
    ],
    "BH": [
        (1, "governorate", "المحافظة", "Governorate", "المحافظات"),
        (2, "area", "المنطقة", "Area / Block", "المناطق"),
    ],
    "OM": [
        (1, "governorate", "المحافظة", "Governorate", "المحافظات"),
        (2, "wilayat", "الولاية", "Wilayat", "الولايات"),
    ],
    "IQ": [
        (1, "governorate", "المحافظة", "Governorate", "المحافظات"),
        (2, "qadaa", "القضاء", "District (Qadaa)", "الأقضية"),
    ],
    "JO": [
        (1, "governorate", "المحافظة", "Governorate", "المحافظات"),
        (2, "liwa", "اللواء", "District (Liwa)", "الألوية"),
    ],
    "PS": [
        (1, "governorate", "المحافظة", "Governorate", "المحافظات"),
        (2, "city_town", "المدينة / البلدة", "City / Town", "المدن والبلدات"),
    ],
    "SY": [
        (1, "governorate", "المحافظة", "Governorate", "المحافظات"),
        (2, "mintaqah", "المنطقة", "District (Mintaqah)", "المناطق"),
        (3, "nahiyah", "الناحية", "Sub-district (Nahiyah)", "النواحي"),
    ],
    "LB": [
        (1, "governorate", "المحافظة", "Governorate", "المحافظات"),
        (2, "qadaa", "القضاء", "District (Qadaa)", "الأقضية"),
    ],
    "EG": [
        (1, "governorate", "المحافظة", "Governorate", "المحافظات"),
        (2, "markaz_qism", "المركز / القسم", "Markaz / Qism", "المراكز والأقسام"),
    ],
    "SD": [
        (1, "state", "الولاية", "State", "الولايات"),
        (2, "locality", "المحلية", "Locality", "المحليات"),
    ],
    "LY": [
        (1, "shabiyah", "الشعبية / المحافظة", "District (Sha'biyah)", "الشعبيات والمحافظات"),
        (2, "city_area", "المدينة / المنطقة", "City / Area", "المدن والمناطق"),
    ],
    "TN": [
        (1, "wilayah", "الولاية", "Governorate (Wilayah)", "الولايات"),
        (2, "delegation", "المعتمدية", "Delegation", "المعتمديات"),
    ],
    "DZ": [
        (1, "wilayah", "الولاية", "Province (Wilayah)", "الولايات"),
        (2, "daira", "الدائرة", "District (Daira)", "الدوائر"),
    ],
    "MA": [
        (1, "region", "الجهة", "Region", "الجهات"),
        (2, "prefecture_province", "العمالة / الإقليم", "Prefecture / Province", "العمالات والأقاليم"),
    ],
    "MR": [
        (1, "wilayah", "الولاية", "Region (Wilayah)", "الولايات"),
        (2, "moughataa", "المقاطعة", "Department (Moughataa)", "المقاطعات"),
    ],
    "SO": [
        (1, "region", "الإقليم", "Region", "الأقاليم"),
        (2, "district_town", "المقاطعة / المدينة", "District / Town", "المقاطعات والمدن"),
    ],
    "DJ": [
        (1, "region", "الإقليم", "Region", "الأقاليم"),
        (2, "district_town", "المقاطعة / المدينة", "District / Town", "المقاطعات والمدن"),
    ],
    "KM": [
        (1, "island", "الجزيرة", "Autonomous Island", "الجزر"),
        (2, "city_town", "المدينة / البلدة", "City / Town", "المدن والبلدات"),
    ],
}


def uid(key: str) -> str:
    return str(uuid.uuid5(NS, key))


def clean_ar(s: str | None) -> str:
    if not s:
        return ""
    s = TASHKEEL_RE.sub("", s).replace("\u0671", "ا")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def clean_en(s: str | None) -> str:
    if not s:
        return ""
    return re.sub(r"\s+", " ", s).strip()


def norm_key(s: str) -> str:
    s = clean_en(s).lower()
    s = re.sub(r"\b(governorate|province|region|wilayah|state|district|municipality|emirate of|emirate)\b", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def is_valid_ar(s: str) -> bool:
    return bool(s and AR_RE.search(s))


def load_wd_cache():
    if os.path.exists(WD_CACHE_PATH):
        return json.load(open(WD_CACHE_PATH, "r", encoding="utf-8"))
    return {}


def load_geonames(cc: str):
    rows = {}
    zpath = os.path.join(GN_CACHE_DIR, f"{cc}.zip")
    with zipfile.ZipFile(zpath) as z:
        with z.open(f"{cc}.txt") as f:
            for line in io.TextIOWrapper(f, "utf-8"):
                p = line.rstrip("\n").split("\t")
                if len(p) < 15:
                    continue
                rows[p[0]] = {
                    "id": p[0],
                    "name": clean_en(p[1]),
                    "ascii": clean_en(p[2]),
                    "alts": p[3],
                    "lat": float(p[4]),
                    "lon": float(p[5]),
                    "fclass": p[6],
                    "fcode": p[7],
                    "adm1": p[10].strip(),
                    "adm2": p[11].strip(),
                    "adm3": p[12].strip(),
                    "pop": int(p[14] or 0),
                }

    ar_alts = {}
    ar_pref = {}
    alt_path = os.path.join(GN_CACHE_DIR, f"{cc}_alt.zip")
    if os.path.exists(alt_path):
        with zipfile.ZipFile(alt_path) as z:
            for nm in z.namelist():
                if nm.endswith(".txt") and not nm.startswith("iso"):
                    with z.open(nm) as f:
                        for line in io.TextIOWrapper(f, "utf-8"):
                            p = line.rstrip("\n").split("\t")
                            if len(p) >= 4 and p[2] == "ar":
                                gid = p[1]
                                name = clean_ar(p[3])
                                if not is_valid_ar(name):
                                    continue
                                is_pref = len(p) > 4 and p[4] == "1"
                                is_short = len(p) > 5 and p[5] == "1"
                                if is_pref:
                                    ar_pref[gid] = name
                                if gid not in ar_alts:
                                    ar_alts[gid] = name
                                elif is_short and gid not in ar_pref:
                                    ar_alts[gid] = name

    for gid, r in rows.items():
        if gid not in ar_pref and gid not in ar_alts:
            for alt in r["alts"].split(","):
                ca = clean_ar(alt)
                if is_valid_ar(ca):
                    ar_alts[gid] = ca
                    break

    merged_ar = {**ar_alts, **ar_pref}
    return rows, merged_ar


def load_ocha_sheets(iso3: str):
    path = os.path.join(OCHA_CACHE_DIR, f"{iso3.lower()}.xlsx")
    if not os.path.exists(path):
        return {}
    out = {}
    with zipfile.ZipFile(path) as z:
        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rid_map = {r.attrib["Id"]: r.attrib["Target"] for r in rels}
        ss = []
        if "xl/sharedStrings.xml" in z.namelist():
            ssx = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in ssx.findall("m:si", ns):
                ss.append("".join(t.text or "" for t in si.findall(".//m:t", ns)))

        for s in wb.findall(".//m:sheet", ns):
            sname = s.attrib["name"]
            if "_em" in sname or "lines" in sname:
                continue
            rid = s.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            target = rid_map.get(rid, "")
            if not target.startswith("xl/"):
                target = "xl/" + target.lstrip("/")
            if target not in z.namelist():
                continue
            sx = ET.fromstring(z.read(target))
            rows_xml = sx.findall(".//m:row", ns)
            if not rows_xml:
                continue

            def parse_row(r):
                vals = {}
                for c in r.findall("m:c", ns):
                    col = "".join(ch for ch in c.attrib.get("r", "") if ch.isalpha())
                    t = c.attrib.get("t")
                    v = c.find("m:v", ns)
                    is_el = c.find("m:is", ns)
                    val = ""
                    if t == "s" and v is not None and v.text is not None:
                        val = ss[int(v.text)]
                    elif t == "inlineStr" and is_el is not None:
                        val = "".join(x.text or "" for x in is_el.findall(".//m:t", ns))
                    elif v is not None:
                        val = v.text or ""
                    vals[col] = val
                return vals

            hdr = parse_row(rows_xml[0])
            data = []
            for r in rows_xml[1:]:
                rv = parse_row(r)
                data.append({hdr[col]: rv.get(col, "") for col in hdr})
            out[sname] = data
    return out


def extract_ocha_pair(row: dict, prefix: str):
    """Extract (name_ar, name_en) from OCHA row regardless of column order (adm1_name vs adm1_name1)."""
    candidates = [
        row.get(f"{prefix}_ar", ""),
        row.get(f"{prefix}_name1", ""),
        row.get(f"{prefix}_name", ""),
        row.get(f"{prefix}_name2", ""),
        row.get(f"{prefix}_name3", ""),
        row.get(f"{prefix}_en", ""),
    ]
    ar_name = ""
    en_name = ""
    for val in candidates:
        s = str(val or "").strip()
        if not s:
            continue
        if AR_RE.search(s) and not ar_name:
            ar_name = clean_ar(s)
        elif not AR_RE.search(s) and re.search(r"[A-Za-z]", s) and not en_name:
            en_name = clean_en(s)
    return ar_name, en_name


def build_gn_coord_index(gn_rows: dict, gn_ar: dict):
    by_en = {}
    by_ar = {}
    for gid, r in gn_rows.items():
        if r["fclass"] not in ("A", "P"):
            continue
        k = norm_key(r["name"])
        if k and (k not in by_en or r["fclass"] == "A"):
            by_en[k] = r
        ka = clean_ar(gn_ar.get(gid, ""))
        if ka and (ka not in by_ar or r["fclass"] == "A"):
            by_ar[ka] = r
    return by_en, by_ar


def match_gn(en_name: str, ar_name: str, by_en: dict, by_ar: dict):
    if ar_name in by_ar:
        return by_ar[ar_name]
    k = norm_key(en_name)
    if k in by_en:
        return by_en[k]
    return None


def main():
    wd_all = load_wd_cache()
    countries_out = []
    levels_out = []
    divisions_out = []

    for cmeta in COUNTRIES_META:
        cc = cmeta["iso2"]
        iso3 = cmeta["iso3"]
        country_id = uid(f"country:{cc}")
        countries_out.append({
            "id": country_id,
            "iso2": cc,
            "iso3": iso3,
            "name_ar": cmeta["name_ar"],
            "name_en": cmeta["name_en"],
            "flag_emoji": cmeta["flag"],
            "phone_code": cmeta["phone"],
            "currency_code": "YER",
            "is_active": True,
            "display_order": cmeta["order"],
        })

        level_map = {}
        for order, code, lar, len_, plural_ar in LEVEL_DEFS[cc]:
            lid = uid(f"level:{cc}:{order}:{code}")
            level_map[order] = lid
            levels_out.append({
                "id": lid,
                "country_id": country_id,
                "level_order": order,
                "code": code,
                "name_ar": lar,
                "name_en": len_,
                "plural_ar": plural_ar,
                "is_active": True,
            })

        gn_rows, gn_ar = load_geonames(cc)
        gn_by_en, gn_by_ar = build_gn_coord_index(gn_rows, gn_ar)
        wd_list = wd_all.get(cc, [])
        wd_by_gn = {x["gn"]: clean_ar(x["ar"]) for x in wd_list if x.get("gn") and is_valid_ar(x.get("ar", ""))}
        wd_by_en = {clean_en(x["en"]).lower(): x for x in wd_list if x.get("en") and is_valid_ar(x.get("ar", ""))}
        wd_by_iso = {x["iso"]: x for x in wd_list if x.get("iso") and is_valid_ar(x.get("ar", ""))}

        def resolve_gn_ar(r):
            gid = r["id"]
            if gid in gn_ar:
                return gn_ar[gid], None
            if gid in wd_by_gn:
                wd_item = next((x for x in wd_list if x.get("gn") == gid), None)
                return wd_by_gn[gid], wd_item.get("wd") if wd_item else None
            w = wd_by_en.get(r["name"].lower())
            if w:
                return clean_ar(w["ar"]), w.get("wd")
            return "", None

        # Per-country builder tracking deduplication cleanly
        country_divs = []
        seen_codes = set()
        seen_siblings = set()

        def add_div(
            level_order: int,
            parent_id: str | None,
            code: str,
            name_ar: str,
            name_en: str,
            data_source: str,
            data_license: str,
            source_url: str,
            gn_id: int | None = None,
            wd_id: str | None = None,
            lat: float | None = None,
            lon: float | None = None,
        ):
            name_ar = clean_ar(name_ar)
            name_en = clean_en(name_en)
            if not is_valid_ar(name_ar) or not name_en:
                return None

            code_clean = clean_en(code)
            if not code_clean or code_clean in seen_codes:
                return None

            level_id = level_map[level_order]
            sib_key = (parent_id or "", level_id, name_en.lower())
            if sib_key in seen_siblings:
                return None

            seen_codes.add(code_clean)
            seen_siblings.add(sib_key)
            div_id = uid(f"div:{cc}:{level_order}:{code_clean}")
            country_divs.append({
                "id": div_id,
                "country_id": country_id,
                "level_id": level_id,
                "level_order": level_order,
                "parent_id": parent_id,
                "code": code_clean,
                "geonames_id": gn_id,
                "wikidata_id": wd_id,
                "name_ar": name_ar,
                "name_en": name_en,
                "latitude": round(lat, 6) if lat is not None else None,
                "longitude": round(lon, 6) if lon is not None else None,
                "is_active": True,
                "data_source": data_source,
                "data_license": data_license,
                "source_url": source_url,
                "last_synced_at": NOW_ISO,
            })
            return div_id

        ocha_src = f"UN OCHA HDX COD-AB ({iso3})"
        ocha_lic = "CC BY-IGO"
        ocha_url = f"https://data.humdata.org/dataset/cod-ab-{iso3.lower()}"
        gn_src = "GeoNames + Wikidata"
        gn_lic = "CC-BY 4.0 / CC0 1.0"
        gn_url = f"https://download.geonames.org/export/dump/{cc}.zip"

        # ------------------------------------------------------------------
        # GROUP A: UN OCHA HDX COD-AB NATIVE BILINGUAL HIERARCHIES
        # ------------------------------------------------------------------
        if cc in ("YE", "QA", "BH", "OM", "IQ", "SY", "LB", "EG", "SD"):
            sheets = load_ocha_sheets(iso3)
            s1 = sheets[f"{iso3.lower()}_admin1"]
            s2 = sheets[f"{iso3.lower()}_admin2"]
            pcode_to_id = {}

            for r in s1:
                p1 = clean_en(r.get("adm1_pcode"))
                ar, en = extract_ocha_pair(r, "adm1")
                m = match_gn(en, ar, gn_by_en, gn_by_ar)
                did = add_div(
                    1, None, p1, ar, en, ocha_src, ocha_lic, ocha_url,
                    gn_id=int(m["id"]) if m else None,
                    lat=m["lat"] if m else None,
                    lon=m["lon"] if m else None,
                )
                if did:
                    pcode_to_id[p1] = did

            for r in s2:
                p2 = clean_en(r.get("adm2_pcode"))
                p1 = clean_en(r.get("adm1_pcode"))
                parent_id = pcode_to_id.get(p1)
                if not parent_id:
                    continue
                ar, en = extract_ocha_pair(r, "adm2")
                if not ar or not en:
                    continue
                m = match_gn(en, ar, gn_by_en, gn_by_ar)
                # Keep distinct pcode; if duplicate English sibling name under same parent (rare OCHA artifacts), skip duplicate
                did = add_div(
                    2, parent_id, p2, ar, en, ocha_src, ocha_lic, ocha_url,
                    gn_id=int(m["id"]) if m else None,
                    lat=m["lat"] if m else None,
                    lon=m["lon"] if m else None,
                )
                if did:
                    pcode_to_id[p2] = did

            # Syria 3rd level (Nahiyahs)
            if cc == "SY" and "syr_admin3" in sheets:
                for r in sheets["syr_admin3"]:
                    p3 = clean_en(r.get("adm3_pcode"))
                    p2 = clean_en(r.get("adm2_pcode"))
                    parent_id = pcode_to_id.get(p2)
                    if not parent_id:
                        continue
                    ar, en = extract_ocha_pair(r, "adm3")
                    m = match_gn(en, ar, gn_by_en, gn_by_ar)
                    add_div(
                        3, parent_id, p3, ar, en, ocha_src, ocha_lic, ocha_url,
                        gn_id=int(m["id"]) if m else None,
                        lat=m["lat"] if m else None,
                        lon=m["lon"] if m else None,
                    )

        elif cc == "LY":
            # Promote lby_admin2 (22 Sha'biyat/Districts) -> Level 1 + lby_populatedplaces -> Level 2
            sheets = load_ocha_sheets(iso3)
            p2_to_id = {}
            for r in sheets["lby_admin2"]:
                p2 = clean_en(r.get("adm2_pcode"))
                ar, en = extract_ocha_pair(r, "adm2")
                m = match_gn(en, ar, gn_by_en, gn_by_ar)
                did = add_div(
                    1, None, p2, ar, en, ocha_src, ocha_lic, ocha_url,
                    gn_id=int(m["id"]) if m else None,
                    lat=m["lat"] if m else None,
                    lon=m["lon"] if m else None,
                )
                if did:
                    p2_to_id[p2] = did

            for r in sheets["lby_populatedplaces"]:
                pcode = clean_en(r.get("pcode"))
                p2 = clean_en(r.get("adm2_pcode"))
                parent_id = p2_to_id.get(p2)
                if not parent_id:
                    continue
                ar = clean_ar(r.get("featurename_ar"))
                en = clean_en(r.get("featurename_en") or r.get("featurerefname"))
                m = match_gn(en, ar, gn_by_en, gn_by_ar)
                add_div(
                    2, parent_id, pcode, ar, en, ocha_src, ocha_lic, ocha_url,
                    gn_id=int(m["id"]) if m else None,
                    lat=m["lat"] if m else None,
                    lon=m["lon"] if m else None,
                )

        elif cc == "TN":
            # Promote tun_admin2 (24 Wilayas) -> Level 1 + tun_admin3 (264 Delegations) -> Level 2
            sheets = load_ocha_sheets(iso3)
            p2_to_id = {}
            for r in sheets["tun_admin2"]:
                p2 = clean_en(r.get("adm2_pcode"))
                ar, en = extract_ocha_pair(r, "adm2")
                m = match_gn(en, ar, gn_by_en, gn_by_ar)
                did = add_div(
                    1, None, p2, ar, en, ocha_src, ocha_lic, ocha_url,
                    gn_id=int(m["id"]) if m else None,
                    lat=m["lat"] if m else None,
                    lon=m["lon"] if m else None,
                )
                if did:
                    p2_to_id[p2] = did

            for r in sheets["tun_admin3"]:
                p3 = clean_en(r.get("adm3_pcode"))
                p2 = clean_en(r.get("adm2_pcode"))
                parent_id = p2_to_id.get(p2)
                if not parent_id:
                    continue
                ar, en = extract_ocha_pair(r, "adm3")
                m = match_gn(en, ar, gn_by_en, gn_by_ar)
                add_div(
                    2, parent_id, p3, ar, en, ocha_src, ocha_lic, ocha_url,
                    gn_id=int(m["id"]) if m else None,
                    lat=m["lat"] if m else None,
                    lon=m["lon"] if m else None,
                )

        elif cc == "PS":
            # Promote 16 official Palestinian Governorates (GeoNames ADM2 + Wikidata P300) -> Level 1
            # + GeoNames populated places (PPLC/PPLA/PPLA2/PPL) with verified Arabic names -> Level 2
            adm2_list = sorted(
                [r for r in gn_rows.values() if r["fcode"] == "ADM2"],
                key=lambda x: x["name"],
            )
            # Match each ADM2 to Wikidata PS-* P300 record for complete official Governorate names
            adm2_to_id = {}
            for r in adm2_list:
                ar, wdid = resolve_gn_ar(r)
                if not ar:
                    # Match against Wikidata P300 entries by English root
                    rn = norm_key(r["name"])
                    for iso_code, witem in wd_by_iso.items():
                        wn = norm_key(witem.get("en", ""))
                        if rn == wn or (rn == "al quds" and wn == "quds") or (rn == "al khalil" and wn == "hebron") or (rn == "ramallah" and "ramallah" in wn):
                            ar = clean_ar(witem["ar"])
                            wdid = witem.get("wd")
                            break
                if not ar:
                    continue
                code = f"PS-{r['id']}"
                did = add_div(
                    1, None, code, ar, r["name"], gn_src, gn_lic, gn_url,
                    gn_id=int(r["id"]), wd_id=wdid, lat=r["lat"], lon=r["lon"]
                )
                if did:
                    adm2_to_id[r["adm2"]] = did

            ppls = sorted(
                [r for r in gn_rows.values() if r["fcode"] in ("PPLC", "PPLA", "PPLA2", "PPLA3", "PPL")],
                key=lambda x: (-x["pop"], x["name"]),
            )
            for r in ppls:
                parent_id = adm2_to_id.get(r["adm2"])
                if not parent_id:
                    continue
                ar, wdid = resolve_gn_ar(r)
                if not ar:
                    continue
                add_div(
                    2, parent_id, f"PS-PPL-{r['id']}", ar, r["name"], gn_src, gn_lic, gn_url,
                    gn_id=int(r["id"]), wd_id=wdid, lat=r["lat"], lon=r["lon"]
                )

        elif cc == "AE":
            # 7 Official Emirates (ADM1) + verified Arabic Cities/Areas (PPLC/PPLA/PPLA2/PPL) per Emirate
            adm1_list = sorted([r for r in gn_rows.values() if r["fcode"] == "ADM1"], key=lambda x: x["adm1"])
            adm1_to_id = {}
            for r in adm1_list:
                ar, wdid = resolve_gn_ar(r)
                if not ar:
                    continue
                did = add_div(
                    1, None, f"AE-{r['adm1']}", ar, r["name"], gn_src, gn_lic, gn_url,
                    gn_id=int(r["id"]), wd_id=wdid, lat=r["lat"], lon=r["lon"]
                )
                if did:
                    adm1_to_id[r["adm1"]] = did

            ppls = sorted(
                [r for r in gn_rows.values() if r["fcode"] in ("PPLC", "PPLA", "PPLA2", "PPL") and r["adm1"] in adm1_to_id],
                key=lambda x: (-x["pop"], x["name"]),
            )
            for r in ppls:
                ar, wdid = resolve_gn_ar(r)
                if not ar:
                    continue
                add_div(
                    2, adm1_to_id[r["adm1"]], f"AE-PPL-{r['id']}", ar, r["name"], gn_src, gn_lic, gn_url,
                    gn_id=int(r["id"]), wd_id=wdid, lat=r["lat"], lon=r["lon"]
                )

        elif cc in ("DJ", "KM"):
            # ADM1 (Regions / Islands) + ADM2/PPL with verified Arabic names
            adm1_list = sorted([r for r in gn_rows.values() if r["fcode"] == "ADM1"], key=lambda x: x["adm1"])
            adm1_to_id = {}
            for r in adm1_list:
                ar, wdid = resolve_gn_ar(r)
                if not ar:
                    continue
                did = add_div(
                    1, None, f"{cc}-{r['adm1']}", ar, r["name"], gn_src, gn_lic, gn_url,
                    gn_id=int(r["id"]), wd_id=wdid, lat=r["lat"], lon=r["lon"]
                )
                if did:
                    adm1_to_id[r["adm1"]] = did

            sub_items = sorted(
                [r for r in gn_rows.values() if r["fcode"] in ("ADM2", "PPLC", "PPLA", "PPLA2", "PPL") and r["adm1"] in adm1_to_id],
                key=lambda x: (0 if x["fcode"] == "ADM2" else 1, -x["pop"], x["name"]),
            )
            for r in sub_items:
                ar, wdid = resolve_gn_ar(r)
                if not ar:
                    continue
                add_div(
                    2, adm1_to_id[r["adm1"]], f"{cc}-SUB-{r['id']}", ar, r["name"], gn_src, gn_lic, gn_url,
                    gn_id=int(r["id"]), wd_id=wdid, lat=r["lat"], lon=r["lon"]
                )

        elif cc == "SO":
            # 18 Official Regions (ADM1) + verified Arabic Districts (ADM2) and Towns (PPL)
            adm1_list = sorted([r for r in gn_rows.values() if r["fcode"] == "ADM1"], key=lambda x: x["adm1"])
            adm1_to_id = {}
            for r in adm1_list:
                ar, wdid = resolve_gn_ar(r)
                if not ar:
                    continue
                did = add_div(
                    1, None, f"SO-{r['adm1']}", ar, r["name"], gn_src, gn_lic, gn_url,
                    gn_id=int(r["id"]), wd_id=wdid, lat=r["lat"], lon=r["lon"]
                )
                if did:
                    adm1_to_id[r["adm1"]] = did

            sub_items = sorted(
                [r for r in gn_rows.values() if r["fcode"] in ("ADM2", "PPLC", "PPLA", "PPLA2", "PPL") and r["adm1"] in adm1_to_id],
                key=lambda x: (0 if x["fcode"] == "ADM2" else 1, -x["pop"], x["name"]),
            )
            for r in sub_items:
                ar, wdid = resolve_gn_ar(r)
                if not ar:
                    continue
                add_div(
                    2, adm1_to_id[r["adm1"]], f"SO-SUB-{r['id']}", ar, r["name"], gn_src, gn_lic, gn_url,
                    gn_id=int(r["id"]), wd_id=wdid, lat=r["lat"], lon=r["lon"]
                )

        else:
            # SA, KW, JO, DZ, MA, MR: GeoNames ADM1 -> ADM2 (-> ADM3 for JO)
            adm1_list = sorted([r for r in gn_rows.values() if r["fcode"] == "ADM1"], key=lambda x: x["adm1"])
            adm1_to_id = {}
            for r in adm1_list:
                ar, wdid = resolve_gn_ar(r)
                if not ar:
                    continue
                did = add_div(
                    1, None, f"{cc}-{r['adm1']}", ar, r["name"], gn_src, gn_lic, gn_url,
                    gn_id=int(r["id"]), wd_id=wdid, lat=r["lat"], lon=r["lon"]
                )
                if did:
                    adm1_to_id[r["adm1"]] = did

            adm2_list = sorted([r for r in gn_rows.values() if r["fcode"] == "ADM2"], key=lambda x: x["name"])
            adm2_to_id = {}
            for r in adm2_list:
                parent_id = adm1_to_id.get(r["adm1"])
                if not parent_id:
                    continue
                ar, wdid = resolve_gn_ar(r)
                if not ar:
                    continue
                did = add_div(
                    2, parent_id, f"{cc}-{r['adm1']}-{r['adm2']}", ar, r["name"], gn_src, gn_lic, gn_url,
                    gn_id=int(r["id"]), wd_id=wdid, lat=r["lat"], lon=r["lon"]
                )
                if did:
                    adm2_to_id[(r["adm1"], r["adm2"])] = did

        divisions_out.extend(country_divs)
        c_l1 = sum(1 for d in country_divs if d["level_order"] == 1)
        c_l2 = sum(1 for d in country_divs if d["level_order"] == 2)
        c_l3 = sum(1 for d in country_divs if d["level_order"] == 3)
        print(f"{cc} ({cmeta['name_ar']}): L1={c_l1}, L2={c_l2}, L3={c_l3}, total={len(country_divs)}")

    # Integrity audit
    div_by_id = {d["id"]: d for d in divisions_out}
    for d in divisions_out:
        assert is_valid_ar(d["name_ar"]), f"Invalid Arabic name: {d}"
        assert d["name_en"], f"Invalid English name: {d}"
        if d["parent_id"]:
            p = div_by_id[d["parent_id"]]
            assert p["country_id"] == d["country_id"], "Cross-country parent"
            assert p["level_order"] < d["level_order"], "Invalid level order"

    os.makedirs("data", exist_ok=True)
    payload = {
        "generated_at": NOW_ISO,
        "countries": countries_out,
        "levels": levels_out,
        "divisions": [
            {k: v for k, v in d.items() if k != "level_order"}
            for d in divisions_out
        ],
    }
    with open("data/arab-geography.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    # Write deterministic SQL seed migration 029
    def sql_str(v):
        if v is None:
            return "NULL"
        return "'" + str(v).replace("'", "''") + "'"

    def sql_num(v):
        return "NULL" if v is None else str(v)

    lines = [
        "-- =============================================================================",
        "-- MIGRATION 029: ARAB LEAGUE (22 COUNTRIES) REAL OPEN-SOURCE GEOGRAPHIC SEED",
        f"-- Generated at: {NOW_ISO}",
        "-- Sources: UN OCHA HDX COD-AB (CC BY-IGO), GeoNames (CC-BY 4.0), Wikidata (CC0)",
        f"-- Totals: {len(countries_out)} countries, {len(levels_out)} admin levels, {len(divisions_out)} divisions",
        "-- =============================================================================",
        "",
        "BEGIN;",
        "",
        "INSERT INTO public.countries (id, iso2, iso3, name_ar, name_en, phone_code, flag_emoji, is_active, sort_order, data_source, data_license, last_synced_at)",
        "VALUES",
    ]
    c_src = {}
    for d in divisions_out:
        if d["country_id"] not in c_src:
            c_src[d["country_id"]] = (d["data_source"], d["data_license"], d["last_synced_at"])
    c_vals = []
    for c in countries_out:
        ds_name, ds_lic, ds_sync = c_src.get(c["id"], ("Open Geo Dataset", "CC BY 4.0", NOW_ISO))
        c_vals.append(
            f"  ({sql_str(c['id'])}, {sql_str(c['iso2'])}, {sql_str(c['iso3'])}, {sql_str(c['name_ar'])}, {sql_str(c['name_en'])}, "
            f"{sql_str(c['phone_code'])}, {sql_str(c['flag_emoji'])}, true, {c['display_order']}, "
            f"{sql_str(ds_name)}, {sql_str(ds_lic)}, {sql_str(ds_sync)})"
        )
    lines.append(",\n".join(c_vals))
    lines.append(
        "ON CONFLICT (id) DO UPDATE SET name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en, "
        "phone_code = EXCLUDED.phone_code, flag_emoji = EXCLUDED.flag_emoji, is_active = EXCLUDED.is_active, "
        "sort_order = EXCLUDED.sort_order, data_source = EXCLUDED.data_source, data_license = EXCLUDED.data_license, "
        "last_synced_at = EXCLUDED.last_synced_at, updated_at = timezone('utc'::text, now());"
    )
    lines.append("")

    lines.append("INSERT INTO public.country_admin_levels (id, country_id, level_order, name_ar, name_en, plural_ar, is_required, is_active)")
    lines.append("VALUES")
    l_vals = []
    for l in levels_out:
        is_req = "true" if l["level_order"] == 1 else "false"
        l_vals.append(
            f"  ({sql_str(l['id'])}, {sql_str(l['country_id'])}, {l['level_order']}, "
            f"{sql_str(l['name_ar'])}, {sql_str(l['name_en'])}, {sql_str(l['plural_ar'])}, {is_req}, true)"
        )
    lines.append(",\n".join(l_vals))
    lines.append("ON CONFLICT (id) DO UPDATE SET name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en, plural_ar = EXCLUDED.plural_ar, is_required = EXCLUDED.is_required, is_active = EXCLUDED.is_active;")
    lines.append("")

    # Sort divisions top-down by level_order so parent_id FKs always resolve
    ordered_divs = sorted(divisions_out, key=lambda d: (d["level_order"], d["country_id"], d["code"]))
    BATCH = 500
    for i in range(0, len(ordered_divs), BATCH):
        chunk = ordered_divs[i : i + BATCH]
        lines.append(
            "INSERT INTO public.administrative_divisions "
            "(id, country_id, level_id, parent_id, code, geonames_id, wikidata_id, name_ar, name_en, latitude, longitude, is_active, data_source, data_license, source_url, last_synced_at)"
        )
        lines.append("VALUES")
        d_vals = []
        for d in chunk:
            d_vals.append(
                f"  ({sql_str(d['id'])}, {sql_str(d['country_id'])}, {sql_str(d['level_id'])}, {sql_str(d['parent_id'])}, "
                f"{sql_str(d['code'])}, {sql_num(d['geonames_id'])}, {sql_str(d['wikidata_id'])}, "
                f"{sql_str(d['name_ar'])}, {sql_str(d['name_en'])}, {sql_num(d['latitude'])}, {sql_num(d['longitude'])}, "
                f"true, {sql_str(d['data_source'])}, {sql_str(d['data_license'])}, {sql_str(d['source_url'])}, {sql_str(d['last_synced_at'])})"
            )
        lines.append(",\n".join(d_vals))
        lines.append(
            "ON CONFLICT (id) DO UPDATE SET "
            "name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en, "
            "latitude = COALESCE(EXCLUDED.latitude, public.administrative_divisions.latitude), "
            "longitude = COALESCE(EXCLUDED.longitude, public.administrative_divisions.longitude), "
            "data_source = EXCLUDED.data_source, data_license = EXCLUDED.data_license, "
            "source_url = EXCLUDED.source_url, last_synced_at = EXCLUDED.last_synced_at, "
            "updated_at = timezone('utc'::text, now());"
        )
        lines.append("")

    lines.append("-- Link legacy YE profiles/tasks to the new relational geography safely")
    lines.append("SELECT public.backfill_arab_geography_legacy_links();")
    lines.append("")
    lines.append("COMMIT;")
    lines.append("")

    with open("supabase/migrations/029_arab_countries_geography_seed.sql", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(
        f"\nSUCCESS: {len(countries_out)} countries, {len(levels_out)} levels, {len(divisions_out)} divisions written to data/arab-geography.json and supabase/migrations/029_arab_countries_geography_seed.sql"
    )


if __name__ == "__main__":
    main()
