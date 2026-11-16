"""Tiny fake LeafLink API for testing sync.py offline. Not used in production."""
import json, random, sys, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

random.seed(4)
BRANDS = [{"id": 1, "name": "Oil"}, {"id": 2, "name": "Sesh"}, {"id": 3, "name": "Panacea"}, {"id": 4, "name": "Wisenheimer"}]
NAMES = {1: ["Classic Cart 1g", "Twist Cart 0.5g", "Live Resin Cart 1g", "Disposable 0.5g"],
         2: ["Pre-Roll 5pk", "Infused Pre-Roll", "Sesh Sample Pack"],
         3: ["Calm Gummies 10pk", "Sleep Gummies 10pk", "CBD Tincture 30ml"],
         4: ["Smart Mints", "Chocolate Bar 100mg"]}
PRODUCTS, pid = [], 100
for b, names in NAMES.items():
    for n in names:
        PRODUCTS.append({"id": pid, "name": n, "display_name": n, "sku": f"SKU{pid}", "brand": b, "image_count": pid % 2}); pid += 1

CITIES = [("Detroit", "MI", "48201", 42.3314, -83.0458), ("Ann Arbor", "MI", "48104", 42.2808, -83.7430),
          ("Lansing", "MI", "48933", 42.7325, -84.5555), ("Grand Rapids", "MI", "49503", 42.9634, -85.6681),
          ("Kalamazoo", "MI", "49007", 42.2917, -85.5872), ("Ferndale", "MI", "48220", 42.4606, -83.1346)]
CUSTOMERS = []
for i in range(24):
    c = CITIES[i % len(CITIES)]
    CUSTOMERS.append({
        "id": 5000 + i, "name": f"Retail LLC {i}", "dba": f"Green Leaf {c[0]} #{i}", "nickname": "",
        "address": f"{100 + i} Main St", "city": c[0], "state": c[1], "zipcode": c[2],
        "delivery_address": {"address": f"{100 + i} Main St", "unit_number": "", "city": c[0], "state": c[1], "zipcode": c[2]},
        "license_type": "Distributor" if i == 3 else "Adult-Use Retailer",
        "phone": "313555%04d" % i, "website": "example.com" if i % 3 == 0 else "",
        "lat": round(c[3] + random.uniform(-.05, .05), 5), "long": round(c[4] + random.uniform(-.05, .05), 5),
        "archived": i == 7,
    })
ORDERS = []
for i in range(80):
    cu = random.choice(CUSTOMERS)
    lines = [{"product": p["id"], "quantity": random.choice([0, 12, 24])} for p in random.sample(PRODUCTS, 3)]
    ORDERS.append({"number": f"o{i}", "customer": {"id": cu["id"], "display_name": cu["dba"]}, "status": "Complete",
                   "ship_date": f"2026-{random.randint(9, 11):02d}-{random.randint(1, 28):02d}", "line_items": lines,
                   "delivery_address": cu["delivery_address"]})
IMAGES = [{"id": i, "product": p["id"], "position": 1, "image": f"https://picsum.photos/seed/{p['id']}/400"} for i, p in enumerate(PRODUCTS) if p["image_count"]]
DATA = {"product-images": IMAGES, "orders-received": ORDERS, "products": PRODUCTS, "brands": BRANDS, "customers": CUSTOMERS}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if self.headers.get("Authorization") != "App testkey":
            self.send_response(401); self.end_headers(); return
        name = u.path.split("/api/v2/")[-1].strip("/")
        q = urllib.parse.parse_qs(u.query)
        rows = DATA.get(name)
        if rows is not None and "product" in q:
            rows = [r for r in rows if str(r.get("product")) == q["product"][0]]
        if rows is None:
            self.send_response(404); self.end_headers(); return
        lim, off = int(q.get("limit", [100])[0]), int(q.get("offset", [0])[0])
        nxt = None
        if off + lim < len(rows):
            qq = dict((k, v[0]) for k, v in q.items()); qq["offset"] = off + lim
            nxt = f"http://127.0.0.1:{PORT}{u.path}?{urllib.parse.urlencode(qq)}"
        body = json.dumps({"count": len(rows), "next": nxt, "previous": None, "results": rows[off:off + lim]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)


PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
HTTPServer(("127.0.0.1", PORT), H).serve_forever()
