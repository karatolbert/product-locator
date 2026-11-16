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
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT, "config.json")
CACHE_PATH = os.path.join(ROOT, "data", "geocache.json")
IMG_CACHE_PATH = os.path.join(ROOT, "data", "imagecache.json")
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


ENTITY = re.compile(r"[,\s]*\b(L\.?L\.?C\.?|Inc\.?|Corp\.?|Corporation|Ltd\.?|Co\.? LLC|Holdings|Ventures|Enterprises)\s*\.?$", re.I)
ENTITY_ANY = re.compile(r"\b(LLC|L\.L\.C|Inc|Corp|Holdings|Ventures|Enterprises)\b\.?", re.I)


def tidy(n):
    n = clean(n).strip(" ,-")
    if "/" in n and "d/b/a" not in n.lower():
        parts = [x.strip() for x in n.split("/") if x.strip()]
        good = [x for x in parts if not ENTITY_ANY.search(x)]
        if good and len(good) < len(parts):
            n = good[0]
    n = re.sub(r"\s*-\s*[RM]\s*$", "", n)                      # "Store - R" / "Store - M"
    n = re.sub(r",?\s*\b(LLC|L\.L\.C\.?|Inc)\b\.?", "", n, flags=re.I)  # LLC anywhere
    n = re.sub(r"\s{2,}", " ", n).strip(" ,-")
    n = re.sub(r"\s*(?:-\s*(?:REC|MED)|\((?:REC|MED|Rec|Med)\))\s*$", "", n).strip(" ,-")
    for _ in range(3):
        n = ENTITY.sub("", n).strip(" ,-")
    if n and (n.isupper() or n.islower()) and len(n) > 4:
        n = " ".join(w if (w.isupper() and len(w) <= 3) else w.capitalize() for w in n.split())
    else:  # shouting words inside an otherwise normal name
        n = " ".join(w.capitalize() if (w.isalpha() and w.isupper() and len(w) > 4) else w for w in n.split())
    return n


def store_name(c, overrides):
    """Pick the name a shopper would recognise from LeafLink's name/dba/nickname."""
    for k in (str(c.get("id")), clean(c.get("name")).lower(), clean(c.get("dba")).lower()):
        if k and k in overrides:
            return overrides[k]
    name, dba, nick = clean(c.get("name")), clean(c.get("dba")), clean(c.get("nickname"))
    if nick:
        return tidy(nick)
    for raw in (name, dba):
        m = re.search(r"\b(?:d/?b/?a|aka)\b[:\s-]*(.+)$", raw, re.I)
        if m:
            return tidy(m.group(1))
        m = re.search(r"\(([^)]+)\)", raw)
        if m and ENTITY_ANY.search(raw) and not re.fullmatch(r"\s*(rec|med|medical|recreational)\s*", m.group(1), re.I):
            return tidy(m.group(1))
    for raw in (name, dba):
        if raw and not ENTITY_ANY.search(raw):
            return tidy(raw)
    return tidy(name or dba or c.get("display_name") or "")


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
    brand_logo = {clean(b.get("name")): b.get("image") or "" for b in brands if b.get("name")}
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
            "image_count": p.get("image_count") or 0,
            "modified": p.get("modified") or p.get("last_edit") or "",
        }
    cust_by_id = {c["id"]: c for c in customers if c.get("id") is not None}

    include_brands = {b.lower() for b in cfg["include_brands"]}
    hide_words = [w.lower() for w in cfg["hide_products_containing"]]
    excl_ids = {str(x) for x in cfg["exclude_customer_ids"]}
    excl_names = [n.lower() for n in cfg["exclude_customer_names"]]
    excl_lic = [k.lower() for k in cfg["exclude_license_type_keywords"]]

    name_over = {str(k).lower(): v for k, v in (cfg.get("name_overrides") or {}).items() if not str(k).startswith("_")}
    stores = {}
    skipped = {"customer_excluded": set(), "no_address": set(), "archived": set()}

    for o in orders:
        c_ref = o.get("customer")
        cid = ident(c_ref)
        cust = cust_by_id.get(cid) or (c_ref if isinstance(c_ref, dict) else {})
        if cid is None:
            continue
        name = store_name(cust, name_over) if cust else ""
        if not name:
            name = clean(c_ref.get("display_name") if isinstance(c_ref, dict) else "")
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
    approx = []
    overrides = {str(k).lower(): v for k, v in (cfg.get("location_overrides") or {}).items() if not str(k).startswith("_")}
    for s in stores.values():
        if s["lat"] is not None and s["lng"] is not None:
            continue
        one = f'{s["address"]}, {s["city"]}, {s["state"]} {s["zip"]}'.strip()
        pin = overrides.get(s["name"].lower()) or overrides.get(str(s["id"]))
        if pin:
            s["lat"], s["lng"] = float(pin[0]), float(pin[1])
            continue
        if cache.get(one):
            hit = cache[one]
        else:
            hit = geocode_census(one) or geocode_nominatim(one)
            if not hit:  # rural / highway addresses: fall back to the town
                hit = geocode_nominatim(f'{s["city"]}, {s["state"]} {s["zip"]}'.strip())
                if hit:
                    approx.append(s["name"])
            cache[one] = hit
            misses += 1
        if hit:
            s["lat"], s["lng"] = hit
    save_json(CACHE_PATH, cache)
    log(f"Geocoded {misses} new addresses")

    # One storefront often has separate REC and MED accounts: merge by address.
    by_addr = {}
    for s in list(stores.values()):
        k = (re.sub(r"[^a-z0-9]", "", s["address"].lower()), s["zip"])
        if k in by_addr:
            keep = by_addr[k]
            for pid, when in s["products"].items():
                keep["products"][pid] = max(keep["products"].get(pid, ""), when)
            keep["last_order"] = max(keep["last_order"], s["last_order"])
            keep["phone"] = keep["phone"] or s["phone"]
            keep["website"] = keep["website"] or s["website"]
            if len(s["name"]) < len(keep["name"]):
                keep["name"] = s["name"]
            keep["name"] = re.sub(r"\s*[-(]\s*(REC|MED|Rec|Med|Medical|Recreational)\)?\s*$", "", keep["name"]).strip()
            del stores[s["id"]]
        else:
            by_addr[k] = s
    log(f"Storefronts after merging shared addresses: {len(stores)}")

    no_coords = [s["name"] for s in stores.values() if s["lat"] is None]
    final = [s for s in stores.values() if s["lat"] is not None]

    # --- output
    # LeafLink often has several listings for the same product (batches, price
    # tiers). Merge them by brand + name, and split "Type - Flavor" names so the
    # widget can offer Brand -> Product -> Flavor.
    def slug(*parts):
        s = "-".join(parts).lower()
        return "".join(ch if ch.isalnum() else "-" for ch in s).strip("-").replace("--", "-")

    merged = {}   # leaflink id -> merged product key
    out_by_key = {}
    used = {pid for s in final for pid in s["products"]}
    for pid in used:
        p = dict(prod_by_id[pid])
        # "... - REC" / "... - MED" listings are the same product for shoppers
        p["name"] = re.sub(r"\s*[-(]\s*(REC|MED|Rec|Med)\)?\s*$", "", p["name"]).strip()
        key = slug(p["brand"], p["name"])
        merged[pid] = key
        if key not in out_by_key:
            ptype, _, variant = p["name"].partition(" - ")
            out_by_key[key] = {"id": key, "brand": p["brand"], "type": ptype.strip(),
                               "variant": variant.strip(), "name": p["name"]}
    # --- combine product types into one product (config: product_groups)
    group_of = {}
    for new, olds in (cfg.get("product_groups") or {}).items():
        if new.startswith("_"):
            continue
        for old in olds:
            group_of[old.lower()] = new
    for v in out_by_key.values():
        new = group_of.get(v["type"].lower())
        if new:
            m = re.search(r"#\s*\d+", v["type"])
            if m and v["variant"].lower() in ("", "twists 4pk", "variety pack"):
                v["variant"] = "Pack " + m.group(0).replace(" ", "")
            elif not v["variant"]:
                v["variant"] = v["type"]
            v["type"] = new

    # --- drop words from product names (config: remove_words, e.g. "Distillate")
    def strip_words(t):
        for w in cfg.get("remove_words") or []:
            t = re.sub(r"\s*\b" + re.escape(w) + r"\b", "", t, flags=re.I)
        return re.sub(r"\s{2,}", " ", t).strip()
    for v in out_by_key.values():
        v["type"], v["name"] = strip_words(v["type"]), strip_words(v["name"])

    # --- product images (LeafLink /product-images/), cached per listing
    img_cache = load_json(IMG_CACHE_PATH, {})
    fetched = 0
    for pid in used:
        p = prod_by_id[pid]
        ck = str(pid)
        if not p.get("image_count"):
            continue
        if ck in img_cache and img_cache[ck].get("modified") == p.get("modified"):
            continue
        try:
            rows = ll.list("product-images", {"product": pid}, page_size=10)
        except SystemExit as e:
            log(f"  image lookup failed for {pid}: {e}")
            continue
        rows = [r for r in rows if ident(r.get("product")) == pid and r.get("image")]
        rows.sort(key=lambda r: (r.get("position") or 99))
        img_cache[ck] = {"modified": p.get("modified"), "image": rows[0]["image"] if rows else ""}
        fetched += 1
    save_json(IMG_CACHE_PATH, img_cache)
    log(f"Looked up images for {fetched} listings")

    for pid in used:  # first listing with a photo wins
        k = merged[pid]
        img = (img_cache.get(str(pid)) or {}).get("image")
        if img and not out_by_key[k].get("image"):
            out_by_key[k]["image"] = img
    type_img = {}
    for v in out_by_key.values():
        if v.get("image"):
            type_img.setdefault((v["brand"], v["type"]), v["image"])
    for v in out_by_key.values():
        if not v.get("image"):
            v["image"] = type_img.get((v["brand"], v["type"]), "")
    with_img = sum(1 for v in out_by_key.values() if v["image"])

    out_products = sorted(out_by_key.values(),
                          key=lambda p: (p["brand"].lower(), p["type"].lower(), p["variant"].lower()))
    for s in final:
        prods = {}
        for pid, when in s["products"].items():
            k = merged[pid]
            prods[k] = max(prods.get(k, ""), when)
        s["products"] = prods
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
        "brand_images": {b: (cfg.get("brand_logos") or {}).get(b) or brand_logo.get(b, "") for b in out_brands},
        "strain_images": {b: {k: v for k, v in m.items() if not k.startswith("_")}
                          for b, m in (cfg.get("strain_images") or {}).items() if not b.startswith("_") and isinstance(m, dict)},
        "type_images": {strip_words(t): v for t, v in (cfg.get("type_images") or {}).items()
                        if not t.startswith("_") and any(p["type"] == strip_words(t) for p in out_products)},
        "products": out_products,
        "stores": out_stores,
    }
    save_json(args.out, payload, pretty=False)

    log("")
    log(f"Orders scanned:      {len(orders)}")
    log(f"Stores in locator:   {len(out_stores)}")
    log(f"Products with a photo: {with_img}/{len(out_products)} (rest fall back to brand logo)")
    log(f"Products in locator: {len(out_products)} across {len(out_brands)} brands: {', '.join(out_brands)}")
    for k, v in skipped.items():
        if v:
            log(f"Skipped ({k}): {len(v)} -> {', '.join(sorted(map(str, v)))[:400]}")
    if approx:
        log(f"Placed at town centre (exact address not found): {', '.join(approx)}")
        log("  -> add exact pins under location_overrides in config.json if needed")
    if no_coords:
        log(f"Could not place on map: {len(no_coords)} -> {', '.join(no_coords)[:400]}")
    log(f"Wrote {args.out}")

    if not out_stores:
        raise SystemExit("No stores produced; refusing to publish an empty locator.")


if __name__ == "__main__":
    main()
