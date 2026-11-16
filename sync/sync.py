#!/usr/bin/env python3
"""
Pull recent wholesale orders from LeafLink and build docs/stores.json
for the website product locator.

A store "carries" a product if it ordered that product within the
lookback window (config.json -> lookback_days).

Usage:
  LEAFLINK_API_KEY=xxxx python3 sync/sync.py
  python3 sync/sync.py --key-file ~/Documents/product-locator/leaflink_key.txt

Standard library only, so it runs anywhere Python 3.9+ is installed.
"""
import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT, "config.json")
CACHE_PATH = os.path.join(ROOT, "data", "geocache.json")
OUT_PATH = os.path.join(ROOT, "docs", "stores.json")

DEFAULT_CONFIG = {
    "base_url": "https://app.leaflink.com/api/v2",
    "auth_scheme": "App",
    "lookback_days": 90,
    "order_statuses": ["Accepted", "Fulfilled", "Shipped", "Complete"],
    "include_brands": [],
    "exclude_customer_ids": [],
    "exclude_customer_names": [],
    "exclude_license_type_keywords": ["distributor", "distribution", "manufactur", "cultivat", "processor", "transport"],
    "hide_products_containing": ["sample", "display", "tester", "promo"],
}


# ----------------------------------------------------------------- helpers
def log(*a):
    print(*a, file=sys.stderr, flush=True)


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save_json(path, data, pretty=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        if pretty:
            json.dump(data, f, indent=2, sort_keys=False)
        else:
            json.dump(data, f, separators=(",", ":"))
        f.write("\n")
    os.replace(tmp, path)


def clean(s):
    return " ".join(str(s or "").split())


def ident(v):
    """LeafLink fields are sometimes an id, sometimes {id, name}."""
    if isinstance(v, dict):
        return v.get("id")
    return v


class LeafLink:
    def __init__(self, key, base_url, scheme):
        self.key = key.strip()
        self.base = base_url.rstrip("/")
        self.scheme = scheme

    def _get(self, url, retries=4):
        for attempt in range(retries):
            req = urllib.request.Request(url, headers={
                "Authorization": f"{self.scheme} {self.key}",
                "Accept": "application/json",
                "User-Agent": "product-locator-sync/1.0",
            })
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code in (401, 403) and self.scheme == "App" and attempt == 0:
                    log("  auth rejected with 'App', retrying with 'Token'")
                    self.scheme = "Token"
                    continue
                if e.code == 429 or e.code >= 500:
                    wait = 2 ** attempt * 3
                    log(f"  HTTP {e.code}, retrying in {wait}s")
                    time.sleep(wait)
                    continue
                body = e.read().decode(errors="replace")[:300]
                raise SystemExit(f"LeafLink API error {e.code} for {url}\n{body}")
            except urllib.error.URLError as e:
                wait = 2 ** attempt * 3
                log(f"  network error {e.reason}, retrying in {wait}s")
                time.sleep(wait)
        raise SystemExit(f"Giving up on {url}")

    def list(self, path, params=None, page_size=100):
        params = dict(params or {})
        params.setdefault("limit", page_size)
        url = f"{self.base}/{path.strip('/')}/?{urllib.parse.urlencode(params)}"
        out = []
        while url:
            data = self._get(url)
            if isinstance(data, list):  # unpaginated endpoint
                return data
            out.extend(data.get("results", []))
            log(f"  {path}: {len(out)}/{data.get('count', '?')}")
            url = data.get("next")
        return out


# ---------------------------------------------------------------- geocoding
def geocode_census(one_line):
    """US Census geocoder: free, no key."""
    q = urllib.parse.urlencode({
        "address": one_line,
        "benchmark": "Public_AR_Current",
        "format": "json",
    })
    url = f"https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?{q}"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            d = json.load(r)
        m = d.get("result", {}).get("addressMatches", [])
        if m:
            c = m[0]["coordinates"]
            return round(c["y"], 6), round(c["x"], 6)
    except Exception as e:  # noqa: BLE001
        log(f"  census geocode failed: {e}")
    return None


def geocode_nominatim(one_line):
    q = urllib.parse.urlencode({"q": one_line, "format": "json", "limit": 1, "countrycodes": "us"})
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{q}",
        headers={"User-Agent": "product-locator-sync/1.0"},
    )
    try:
        time.sleep(1.1)  # Nominatim policy: max 1 req/sec
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.load(r)
        if d:
            return round(float(d[0]["lat"]), 6), round(float(d[0]["lon"]), 6)
    except Exception as e:  # noqa: BLE001
        log(f"  nominatim geocode failed: {e}")
    return None


# ---------------------------------------------------------------- main build
def pick_address(cust, order_addr):
    """Prefer the customer's delivery address (the storefront)."""
    for src in (cust.get("delivery_address"), order_addr, cust):
        if isinstance(src, dict) and clean(src.get("address")) and clean(src.get("city")):
            return {
                "address": clean(src.get("address")),
                "unit": clean(src.get("unit_number")),
                "city": clean(src.get("city")),
                "state": clean(src.get("state")),
                "zip": clean(src.get("zipcode"))[:5],
            }
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key-file", help="text file containing the LeafLink API key")
    ap.add_argument("--out", default=OUT_PATH)
    ap.add_argument("--dump-raw", help="folder to write raw API responses (for debugging)")
    args = ap.parse_args()

    cfg = {**DEFAULT_CONFIG, **load_json(CONFIG_PATH, {})}
    if os.environ.get("LEAFLINK_BASE_URL"):
        cfg["base_url"] = os.environ["LEAFLINK_BASE_URL"]

    key = os.environ.get("LEAFLINK_API_KEY", "")
    if args.key_file:
        with open(os.path.expanduser(args.key_file)) as f:
            key = f.read().strip()
    if not key:
        raise SystemExit("No API key: set LEAFLINK_API_KEY or pass --key-file")

    ll = LeafLink(key, cfg["base_url"], cfg["auth_scheme"])
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=int(cfg["lookback_days"]))).date().isoformat()

    log(f"Fetching orders since {since} ...")
    orders = ll.list("orders-received", {
        "status": ",".join(cfg["order_statuses"]),
        "created_on__gte": since,
        "include_children": "line_items,customer",
    }, page_size=50)

    log("Fetching products ...")
    products = ll.list("products")
    log("Fetching brands ...")
    try:
        brands = ll.list("brands")
    except SystemExit as e:
        log(f"  couldn't list brands ({e}); falling back to names on products")
        brands = []
    log("Fetching customers ...")
    customers = ll.list("customers")

    if args.dump_raw:
        d = os.path.expanduser(args.dump_raw)
        for name, data in [("orders", orders), ("products", products), ("brands", brands), ("customers", customers)]:
            save_json(os.path.join(d, f"raw_{name}.json"), data)
        log(f"Raw responses written to {d}")

    # --- lookups
    brand_name = {b["id"]: clean(b.get("name")) for b in brands if b.get("id") is not None}
    prod_by_id = {}
    for p in products:
        b = p.get("brand")
        bid = ident(b)
        bname = brand_name.get(bid) or (clean(b.get("name")) if isinstance(b, dict) else "")
        prod_by_id[p["id"]] = {
            "id": p["id"],
            "name": clean(p.get("display_name") or p.get("name")),
            "brand_id": bid,
            "brand": bname or "Other",
            "sku": clean(p.get("sku")),
        }
    cust_by_id = {c["id"]: c for c in customers if c.get("id") is not None}

    include_brands = {b.lower() for b in cfg["include_brands"]}
    hide_words = [w.lower() for w in cfg["hide_products_containing"]]
    excl_ids = {str(x) for x in cfg["exclude_customer_ids"]}
    excl_names = [n.lower() for n in cfg["exclude_customer_names"]]
    excl_lic = [k.lower() for k in cfg["exclude_license_type_keywords"]]

    stores = {}
    skipped = {"customer_excluded": set(), "no_address": set(), "archived": set()}

    for o in orders:
        c_ref = o.get("customer")
        cid = ident(c_ref)
        cust = cust_by_id.get(cid) or (c_ref if isinstance(c_ref, dict) else {})
        if cid is None:
            continue
        name = clean(cust.get("dba") or cust.get("display_name") or cust.get("name") or cust.get("nickname"))
        lic = clean(cust.get("license_type") if not isinstance(cust.get("license_type"), dict)
                    else cust["license_type"].get("type") or cust["license_type"].get("name")).lower()

        if (str(cid) in excl_ids or any(n and n in name.lower() for n in excl_names)
                or any(k in lic for k in excl_lic)):
            skipped["customer_excluded"].add(name or cid)
            continue
        if cust.get("archived"):
            skipped["archived"].add(name or cid)
            continue

        when = (o.get("ship_date") or o.get("created_on") or "")[:10]
        lines = o.get("line_items") or []
        for li in lines:
            pref = li.get("product")
            pid = ident(pref)
            prod = prod_by_id.get(pid)
            if not prod and isinstance(pref, dict):
                b = pref.get("brand")
                prod = {"id": pid, "name": clean(pref.get("display_name") or pref.get("name")),
                        "brand_id": ident(b),
                        "brand": brand_name.get(ident(b)) or (clean(b.get("name")) if isinstance(b, dict) else "Other"),
                        "sku": clean(pref.get("sku"))}
                prod_by_id[pid] = prod
            if not prod or not prod["name"]:
                continue
            if include_brands and prod["brand"].lower() not in include_brands:
                continue
            if any(w in prod["name"].lower() for w in hide_words):
                continue
            try:
                if float(li.get("quantity") or 0) <= 0:
                    continue
            except (TypeError, ValueError):
                pass

            s = stores.get(cid)
            if s is None:
                addr = pick_address(cust, o.get("delivery_address"))
                if not addr:
                    skipped["no_address"].add(name or cid)
                    continue
                lat, lng = cust.get("lat"), cust.get("long")
                s = stores[cid] = {
                    "id": cid, "name": name, **addr,
                    "phone": clean(cust.get("phone")),
                    "website": clean(cust.get("website")),
                    "lat": float(lat) if lat not in (None, "", 0, "0") else None,
                    "lng": float(lng) if lng not in (None, "", 0, "0") else None,
                    "products": {}, "last_order": "",
                }
            s["products"][pid] = max(s["products"].get(pid, ""), when)
            s["last_order"] = max(s["last_order"], when)

    # --- geocode anything missing coordinates (cached between runs)
    cache = load_json(CACHE_PATH, {})
    misses = 0
    for s in stores.values():
        if s["lat"] is not None and s["lng"] is not None:
            continue
        one = f'{s["address"]}, {s["city"]}, {s["state"]} {s["zip"]}'.strip()
        if one in cache:
            hit = cache[one]
        else:
            hit = geocode_census(one) or geocode_nominatim(one)
            cache[one] = hit
            misses += 1
        if hit:
            s["lat"], s["lng"] = hit
    save_json(CACHE_PATH, cache)
    log(f"Geocoded {misses} new addresses")

    no_coords = [s["name"] for s in stores.values() if s["lat"] is None]
    final = [s for s in stores.values() if s["lat"] is not None]

    # --- output
    used = {pid for s in final for pid in s["products"]}
    out_products = sorted(
        ({"id": p["id"], "name": p["name"], "brand": p["brand"]} for pid, p in prod_by_id.items() if pid in used),
        key=lambda p: (p["brand"].lower(), p["name"].lower()),
    )
    out_brands = sorted({p["brand"] for p in out_products}, key=str.lower)
    out_stores = []
    for s in sorted(final, key=lambda s: (s["state"], s["city"], s["name"])):
        out_stores.append({
            "id": s["id"], "name": s["name"],
            "address": s["address"] + (f' {s["unit"]}' if s["unit"] else ""),
            "city": s["city"], "state": s["state"], "zip": s["zip"],
            "phone": s["phone"], "website": s["website"],
            "lat": s["lat"], "lng": s["lng"],
            "last_order": s["last_order"],
            "products": sorted(s["products"]),
        })

    payload = {
        "updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "lookback_days": int(cfg["lookback_days"]),
        "brands": out_brands,
        "products": out_products,
        "stores": out_stores,
    }
    save_json(args.out, payload, pretty=False)

    log("")
    log(f"Orders scanned:      {len(orders)}")
    log(f"Stores in locator:   {len(out_stores)}")
    log(f"Products in locator: {len(out_products)} across {len(out_brands)} brands: {', '.join(out_brands)}")
    for k, v in skipped.items():
        if v:
            log(f"Skipped ({k}): {len(v)} -> {', '.join(sorted(map(str, v)))[:400]}")
    if no_coords:
        log(f"Could not place on map: {len(no_coords)} -> {', '.join(no_coords)[:400]}")
    log(f"Wrote {args.out}")

    if not out_stores:
        raise SystemExit("No stores produced; refusing to publish an empty locator.")


if __name__ == "__main__":
    main()
