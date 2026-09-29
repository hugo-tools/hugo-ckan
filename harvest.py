#!/usr/bin/env python3
"""Snapshot a CKAN portal's metadata into data/ckan/*.json for the Hugo build.

Uses only the public CKAN Action API (v3) and the Python stdlib.

    python3 harvest.py https://demo.ckan.org
    python3 harvest.py https://opendata.swiss --lang it --max 500
"""
import argparse
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request

PAGE = 1000  # CKAN's default ckan.search.rows_max


def call(base, action, **params):
    url = f"{base.rstrip('/')}/api/3/action/{action}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "hugo-ckan-harvester/0.1"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = json.load(r)
            if not body.get("success"):
                raise RuntimeError(body.get("error"))
            return body["result"]
        except Exception as e:  # noqa: BLE001 - retry anything transient
            if attempt == 3:
                raise
            print(f"  retry {action}: {e}", file=sys.stderr)
            time.sleep(2 ** attempt)


LANG_KEY = re.compile(r"^[a-z]{2}([-_][A-Za-z]{2})?$")


def localize(value, lang):
    """Multilingual portals (ckanext-fluent/scheming) return {"en": .., "it": ..}."""
    if (isinstance(value, dict) and value
            and (lang in value or "en" in value)
            and all(LANG_KEY.match(k) and (v is None or isinstance(v, (str, list))) for k, v in value.items())):
        return value.get(lang) or next((v for v in value.values() if v), "")
    if isinstance(value, list):
        return [localize(v, lang) for v in value]
    return value


def localize_obj(obj, lang):
    if isinstance(obj, dict):
        return {k: localize_obj(localize(v, lang), lang) for k, v in obj.items()}
    if isinstance(obj, list):
        return [localize_obj(v, lang) for v in obj]
    return obj


def harvest_packages(base, limit):
    out, start = [], 0
    while True:
        rows = min(PAGE, limit - len(out)) if limit else PAGE
        res = call(base, "package_search", rows=rows, start=start, sort="name asc")
        out.extend(res["results"])
        print(f"  packages {len(out)}/{res['count']}", file=sys.stderr)
        start += len(res["results"])
        if not res["results"] or start >= res["count"] or (limit and len(out) >= limit):
            return out


def harvest_groups(base, action):
    try:
        return call(base, action, all_fields="true", include_extras="true", limit=1000)
    except Exception as e:  # noqa: BLE001 - some portals disable groups
        print(f"  {action} unavailable: {e}", file=sys.stderr)
        return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url", help="CKAN base URL, e.g. https://demo.ckan.org")
    ap.add_argument("--max", type=int, default=0, help="max datasets (0 = all)")
    ap.add_argument("--lang", default="en", help="language for multilingual fields")
    ap.add_argument("--out", default="data/ckan")
    a = ap.parse_args()

    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    print(f"Harvesting {a.url}", file=sys.stderr)
    try:
        status = call(a.url, "status_show")
    except Exception:  # noqa: BLE001
        status = {}
    site = {
        "source_url": a.url.rstrip("/"),
        "site_title": status.get("site_title") or urllib.parse.urlparse(a.url).netloc,
        "site_description": status.get("site_description", ""),
        "ckan_version": status.get("ckan_version", ""),
        "harvested_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    packages = localize_obj(harvest_packages(a.url, a.max), a.lang)
    orgs = localize_obj(harvest_groups(a.url, "organization_list"), a.lang)
    groups = localize_obj(harvest_groups(a.url, "group_list"), a.lang)
    try:
        licenses = call(a.url, "license_list")
    except Exception:  # noqa: BLE001
        licenses = []

    # Organizations/groups that only appear embedded in packages (e.g. list API disabled)
    known = {o["name"] for o in orgs}
    for p in packages:
        o = p.get("organization")
        if o and o["name"] not in known:
            orgs.append(o)
            known.add(o["name"])

    for name, obj in [("site", site), ("packages", packages), ("organizations", orgs),
                      ("groups", groups), ("licenses", licenses)]:
        (out / f"{name}.json").write_text(json.dumps(obj, ensure_ascii=False))
    print(f"Done: {len(packages)} datasets, {len(orgs)} orgs, {len(groups)} groups -> {out}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
