/*
 * Product Locator widget
 * Embed on any page (e.g. a Squarespace Code Block):
 *
 *   <div id="product-locator"></div>
 *   <script src="https://YOUR-USER.github.io/product-locator/locator.js" defer></script>
 *
 * Optional attributes on the div:
 *   data-src="https://.../stores.json"   data file (defaults to stores.json next to this script)
 *   data-accent="#1a1a1a"                 button / highlight colour
 *   data-brand="Sesh"                     preselect a brand
 *   data-height="640"                     widget height in px (desktop)
 * Page URL parameters ?brand=Sesh, ?product=<name> and ?strain=Blue%20Dream preselect filters.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var scriptBase = script ? script.src.replace(/[^\/]*$/, "") : "";
  var LEAFLET_CSS = scriptBase + "vendor/leaflet/leaflet.css";
  var LEAFLET_JS = scriptBase + "vendor/leaflet/leaflet.js";

  // ------------------------------------------------------------ utilities
  function loadCSS(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href;
    document.head.appendChild(l);
  }
  function loadJS(src) {
    return new Promise(function (res, rej) {
      if (window.L && window.L.map) return res();
      var s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function miles(a, b) {
    var R = 3958.8, r = Math.PI / 180;
    var dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtPhone(p) {
    var d = (p || "").replace(/\D/g, "");
    if (d.length === 11 && d[0] === "1") d = d.slice(1);
    return d.length === 10 ? "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6) : p;
  }
  function norm(s) { return (s || "").toLowerCase().trim(); }

  function geocode(q) {
    q = q.trim();
    if (/^\d{5}$/.test(q)) {
      return fetch("https://api.zippopotam.us/us/" + q).then(function (r) {
        if (!r.ok) throw new Error("zip");
        return r.json();
      }).then(function (d) {
        var p = d.places[0];
        return { lat: +p.latitude, lng: +p.longitude, label: p["place name"] + ", " + p["state abbreviation"] };
      });
    }
    var url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" + encodeURIComponent(q);
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.length) throw new Error("none");
        return { lat: +d[0].lat, lng: +d[0].lon, label: d[0].display_name.split(",").slice(0, 2).join(",") };
      });
  }

  // ------------------------------------------------------------ styles
  var CSS = [
    ".pl{--pl-accent:#1a1a1a;--pl-line:#e3e3e3;--pl-muted:#6b6b6b;--pl-bg:#fff;--pl-soft:#f6f6f4;",
    "font-family:inherit;color:#1a1a1a;background:var(--pl-bg);border:1px solid var(--pl-line);border-radius:14px;overflow:hidden;line-height:1.4;font-size:15px;text-align:left}",
    ".pl *{box-sizing:border-box}",
    ".pl-bar{display:grid;grid-template-columns:minmax(230px,1.5fr) .8fr 1.4fr 1fr 104px;gap:10px;padding:14px;border-bottom:1px solid var(--pl-line);background:var(--pl-soft)}",
    ".pl-search{display:flex;gap:6px}",
    ".pl input,.pl select{width:100%;height:42px;border:1px solid var(--pl-line);border-radius:9px;padding:0 12px;font:inherit;font-size:15px;background:#fff;color:inherit;margin:0;-webkit-appearance:none;appearance:none}",
    ".pl select:disabled{opacity:.5;cursor:not-allowed}.pl select{background-image:linear-gradient(45deg,transparent 50%,#888 50%),linear-gradient(135deg,#888 50%,transparent 50%);background-position:calc(100% - 17px) 18px,calc(100% - 12px) 18px;background-size:5px 5px;background-repeat:no-repeat;padding-right:30px;text-overflow:ellipsis}",
    ".pl input:focus,.pl select:focus{outline:2px solid var(--pl-accent);outline-offset:-1px}",
    ".pl-btn{height:42px;min-width:42px;border:0;border-radius:9px;background:var(--pl-accent);color:#fff;font:inherit;font-size:14px;font-weight:600;padding:0 14px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:6px}",
    ".pl-btn.pl-ghost{background:#fff;color:var(--pl-accent);border:1px solid var(--pl-line)}",
    ".pl-btn svg{width:18px;height:18px}",
    ".pl-body{display:grid;grid-template-columns:380px 1fr;height:var(--pl-h,620px)}",
    ".pl-side{display:flex;flex-direction:column;border-right:1px solid var(--pl-line);min-height:0}",
    ".pl-feat{display:flex;gap:14px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--pl-line)}",
    ".pl-feat[hidden]{display:none}",
    ".pl-imgs{display:flex;gap:6px;flex:none}",
    ".pl-imgs.pl-multi img{width:72px;height:72px}",
    ".pl-feat img{width:96px;height:96px;object-fit:contain;border-radius:10px;background:var(--pl-soft);flex:none}",
    ".pl-feat .pl-ft{font-weight:700;font-size:15px;line-height:1.25}",
    ".pl-feat .pl-fs{font-size:13px;color:var(--pl-muted);margin-top:2px}",
    ".pl-status{padding:10px 16px;font-size:13px;color:var(--pl-muted);border-bottom:1px solid var(--pl-line)}",
    ".pl-status b{color:#1a1a1a}",".pl-status a{color:var(--pl-accent);font-weight:600}",
    ".pl-list{overflow-y:auto;flex:1;min-height:0}",
    ".pl-card{padding:14px 16px;border-bottom:1px solid var(--pl-line);cursor:pointer;transition:background .15s}",
    ".pl-card:hover{background:var(--pl-soft)}",
    ".pl-card.pl-on{background:var(--pl-soft);box-shadow:inset 3px 0 0 var(--pl-accent)}",
    ".pl-top{display:flex;justify-content:space-between;gap:10px;align-items:baseline}",
    ".pl-name{font-weight:700;font-size:16px;margin:0}",
    ".pl-dist{font-size:13px;color:var(--pl-muted);white-space:nowrap}",
    ".pl-addr{color:var(--pl-muted);font-size:14px;margin:3px 0 8px}",
    ".pl-chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px}",
    ".pl-chip{font-size:12px;background:#fff;border:1px solid var(--pl-line);border-radius:999px;padding:2px 9px}",
    ".pl-chip.pl-more{background:transparent;border-style:dashed;cursor:pointer}",
    ".pl-links{display:flex;gap:14px;font-size:13px;font-weight:600}",
    ".pl-links a{color:var(--pl-accent);text-decoration:underline;text-underline-offset:2px}",
    ".pl-map{min-height:0;z-index:0}",
    ".pl .leaflet-tile-pane{filter:grayscale(.85) brightness(1.04) contrast(.92)}",
    ".pl-pin{width:34px;height:34px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);overflow:hidden;background:var(--pl-accent);transition:transform .15s}",
    ".pl-pin img{width:100%;height:100%;object-fit:cover;display:block;transform:scale(1.55)}",
    ".pl-pin.pl-on{transform:scale(1.35);box-shadow:0 2px 8px rgba(0,0,0,.45)}",
    ".pl-pin-wrap{background:none;border:0}",
    ".pl-empty{padding:30px 20px;text-align:center;color:var(--pl-muted)}",
    ".pl-foot{padding:9px 16px;font-size:12px;color:var(--pl-muted);border-top:1px solid var(--pl-line);background:var(--pl-soft)}",
    ".pl .leaflet-popup-content{font-family:inherit;font-size:14px;margin:12px 14px}",
    ".pl-pop b{display:block;font-size:15px;margin-bottom:2px}",
    "@media (max-width:860px){.pl-bar{grid-template-columns:1fr 104px}.pl-search{grid-column:1/-1}",
    ".pl-bar .pl-prod,.pl-bar .pl-var{grid-column:1/-1;order:3}",
    ".pl-body{grid-template-columns:1fr;grid-template-rows:300px auto;height:auto}",
    ".pl-map{order:-1;height:300px}.pl-side{border-right:0}.pl-list{max-height:none}}"
  ].join("");

  var ICON_LOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/></svg>';

  // ------------------------------------------------------------ widget
  function Locator(root) {
    this.root = root;
    this.src = root.getAttribute("data-src") || scriptBase + "stores.json";
    this.origin = null;
    this.markers = {};
    this.activeId = null;
    var params = new URLSearchParams(location.search);
    this.initBrand = params.get("brand") || root.getAttribute("data-brand") || "";
    this.initProduct = params.get("product") || "";
    this.initStrain = params.get("strain") || root.getAttribute("data-strain") || "";
    this.build();
    this.load();
  }

  Locator.prototype.build = function () {
    var self = this, r = this.root;
    r.classList.add("pl");
    if (r.getAttribute("data-accent")) r.style.setProperty("--pl-accent", r.getAttribute("data-accent"));
    if (r.getAttribute("data-height")) r.style.setProperty("--pl-h", parseInt(r.getAttribute("data-height"), 10) + "px");
    r.innerHTML = "";

    this.q = el("input", { type: "search", placeholder: "ZIP code, city, or dispensary name", "aria-label": "ZIP code, city, or dispensary name",
      onkeydown: function (e) { if (e.key === "Enter") { e.preventDefault(); self.search(); } } });
    var go = el("button", { class: "pl-btn", type: "button", text: "Search", onclick: function () { self.search(); } });
    var me = el("button", { class: "pl-btn pl-ghost", type: "button", title: "Use my location", "aria-label": "Use my location",
      html: ICON_LOC, onclick: function () { self.locate(); } });
    this.brandSel = el("select", { "aria-label": "Brand", onchange: function () { self.refresh(); self.render(true); } });
    this.prodSel = el("select", { "aria-label": "Product", class: "pl-prod", onchange: function () { self.refresh(); self.render(true); } });
    this.varSel = el("select", { "aria-label": "Strain", class: "pl-var", onchange: function () { self.refresh(); self.render(true); } });
    this.radiusSel = el("select", { "aria-label": "Distance", onchange: function () { self.render(true); } });
    [["10", "10 mi"], ["25", "25 mi"], ["50", "50 mi"], ["100", "100 mi"], ["0", "Any distance"]].forEach(function (o) {
      self.radiusSel.appendChild(el("option", { value: o[0], text: o[1] }));
    });
    this.radiusSel.value = "25";

    this.feat = el("div", { class: "pl-feat", hidden: "" });
    this.status = el("div", { class: "pl-status", "aria-live": "polite", text: "Loading stores…" });
    this.list = el("div", { class: "pl-list" });
    this.mapEl = el("div", { class: "pl-map" });
    this.foot = el("div", { class: "pl-foot" });

    r.appendChild(el("div", { class: "pl-bar" }, [
      el("div", { class: "pl-search" }, [this.q, go, me]),
      this.brandSel, this.prodSel, this.varSel, this.radiusSel
    ]));
    r.appendChild(el("div", { class: "pl-body" }, [
      el("div", { class: "pl-side" }, [this.feat, this.status, this.list]),
      this.mapEl
    ]));
    r.appendChild(this.foot);
  };

  Locator.prototype.load = function () {
    var self = this;
    Promise.all([
      fetch(this.src, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
      loadJS(LEAFLET_JS)
    ]).then(function (res) {
      self.data = res[0];
      self.prodById = {};
      self.data.products.forEach(function (p) { self.prodById[p.id] = p; });
      self.initMap();
      self.fillBrands();
      self.render(true);
      var d = new Date(self.data.updated);
      self.foot.textContent = "Stores that ordered from us in the last " + self.data.lookback_days +
        " days. Stock changes quickly, so please call ahead to confirm. Updated " +
        d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) + ".";
    }).catch(function (e) {
      console.error("[locator]", e);
      self.status.textContent = "Sorry, the store list couldn't load. Please try again later.";
    });
  };

  Locator.prototype.initMap = function () {
    var L = window.L;
    this.map = L.map(this.mapEl, { scrollWheelZoom: false, zoomControl: true }).setView([39.5, -98.35], 4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this.map);
    this.layer = L.layerGroup().addTo(this.map);
    var self = this;
    this.map.on("focus", function () { self.map.scrollWheelZoom.enable(); });
    this.map.on("blur", function () { self.map.scrollWheelZoom.disable(); });
  };

  Locator.prototype.fillBrands = function () {
    var s = this.brandSel, self = this, d = this.data;
    s.innerHTML = "";
    s.appendChild(el("option", { value: "", text: "All brands" }));
    d.brands.forEach(function (b) { s.appendChild(el("option", { value: b, text: b })); });
    var want = d.brands.filter(function (b) { return norm(b) === norm(self.initBrand); })[0];
    if (want) s.value = want;
    this.fillTypes();
    var q = norm(this.initProduct);
    if (q) {
      var p = d.products.filter(function (p) { return p.id === q || norm(p.name) === q; })[0];
      var t = p ? null : d.products.filter(function (p) { return norm(p.type) === q; })[0];
      var hit = p || t;
      if (hit) {
        s.value = hit.brand; this.fillTypes();
        this.prodSel.value = hit.brand + "||" + hit.type;
        this.fillVariants();
        if (p && p.variant) this.varSel.value = norm(p.variant);
      }
    }
    if (this.initStrain) { this.fillVariants(); this.varSel.value = norm(this.initStrain); }
    this.refresh();
  };

  // Keep Brand / Product / Strain consistent with each other
  Locator.prototype.refresh = function () {
    this.fillTypes(); this.fillVariants(true); this.fillTypes();
  };

  // Product = product type within a brand (e.g. "Oil Tugboat All In One (1g)")
  Locator.prototype.fillTypes = function () {
    var b = this.brandSel.value, v = this.varSel.value, s = this.prodSel, prev = s.value, seen = {}, groups = {};
    s.innerHTML = "";
    var vt = v && this.varSel.selectedIndex > 0 ? this.varSel.options[this.varSel.selectedIndex].text + " " : "";
    s.appendChild(el("option", { value: "", text: "All " + (b ? b + " " : "") + vt + "products" }));
    this.data.products.forEach(function (p) {
      if (b && p.brand !== b) return;
      if (v && norm(p.variant) !== v) return;   // strain picked first: only products it comes in
      var k = p.brand + "||" + p.type;
      if (seen[k]) return;
      seen[k] = 1;
      (groups[p.brand] = groups[p.brand] || []).push(p);
    });
    Object.keys(groups).sort().forEach(function (g) {
      var parent = b ? s : s.appendChild(el("optgroup", { label: g }));
      groups[g].forEach(function (p) { parent.appendChild(el("option", { value: p.brand + "||" + p.type, text: p.type })); });
    });
    if (prev && seen[prev]) s.value = prev;
  };

  // Strain list: every strain, narrowed by brand / product when those are chosen.
  // Non-strain variants (battery colours, variety packs) are left out.
  function isStrain(p) {
    return p.variant && !/battery|variety|sampler/i.test(p.type + " " + p.variant);
  }
  Locator.prototype.fillVariants = function (keep) {
    var s = this.varSel, b = this.brandSel.value, t = this.prodSel.value, prev = s.value, seen = {}, list = [];
    this.data.products.forEach(function (p) {
      if (!isStrain(p)) return;
      if (t ? p.brand + "||" + p.type !== t : b && p.brand !== b) return;
      var k = norm(p.variant);
      if (!seen[k]) { seen[k] = 1; list.push(p.variant); }
    });
    list.sort(function (a, c) { return a.localeCompare(c); });
    s.innerHTML = "";
    s.appendChild(el("option", { value: "", text: list.length ? "All strains" : "—" }));
    list.forEach(function (v) { s.appendChild(el("option", { value: norm(v), text: v })); });
    s.disabled = !list.length;
    if (keep && prev && seen[prev]) s.value = prev;
  };

  Locator.prototype.wanted = function () {
    var b = this.brandSel.value, t = this.prodSel.value, v = this.varSel.value;
    if (!b && !t && !v) return null;
    var ok = {};
    this.data.products.forEach(function (p) {
      if (t ? p.brand + "||" + p.type !== t : b && p.brand !== b) return;
      if (v && norm(p.variant) !== v) return;
      ok[p.id] = 1;
    });
    return ok;
  };

  Locator.prototype.matches = function (store, ok) {
    return !ok || store.products.some(function (x) { return ok[x]; });
  };

  Locator.prototype.search = function () {
    var self = this, q = this.q.value;
    this.nameQuery = "";
    if (!q.trim()) { this.origin = null; this.render(true); return; }
    // A dispensary name? (but a town we serve, or a ZIP, is a location search)
    var nq = norm(q).replace(/[^a-z0-9 ]/g, "");
    var isTown = this.data.stores.some(function (s) { return norm(s.city) === nq.replace(/\s+(co|colorado)$/, ""); });
    if (!/^\d{5}$/.test(q.trim()) && !isTown && nq.length >= 3) {
      var hits = this.data.stores.filter(function (s) { return norm(s.name).replace(/[^a-z0-9 ]/g, "").indexOf(nq) >= 0; });
      if (hits.length) { this.nameQuery = nq; this.origin = null; this.render(true); return; }
    }
    this.status.textContent = "Finding " + q + "…";
    geocode(q).then(function (o) { self.origin = o; self.render(true); })
      .catch(function () { self.status.textContent = "We couldn't find “" + q + "”. Try a 5-digit ZIP code."; });
  };

  Locator.prototype.locate = function () {
    var self = this;
    if (!navigator.geolocation) { this.status.textContent = "Your browser can't share location. Try a ZIP code."; return; }
    this.status.textContent = "Finding your location…";
    navigator.geolocation.getCurrentPosition(function (p) {
      self.origin = { lat: p.coords.latitude, lng: p.coords.longitude, label: "your location" };
      self.q.value = ""; self.nameQuery = "";
      self.render(true);
    }, function () { self.status.textContent = "Location wasn't shared. Enter a ZIP code instead."; },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  };

  Locator.prototype.render = function (fit) {
    var self = this, L = window.L, o = this.origin;
    var radius = +this.radiusSel.value;
    var ok = this.wanted();
    var nq = this.nameQuery;
    var rows = this.data.stores.filter(function (s) {
      return self.matches(s, ok) && (!nq || norm(s.name).replace(/[^a-z0-9 ]/g, "").indexOf(nq) >= 0);
    }).map(function (s) {
      return { s: s, d: o ? miles([o.lat, o.lng], [s.lat, s.lng]) : null };
    });
    var total = rows.length;
    if (o && radius) rows = rows.filter(function (r) { return r.d <= radius; });
    rows.sort(o ? function (a, b) { return a.d - b.d; }
      : function (a, b) { return (a.s.state + a.s.city + a.s.name).localeCompare(b.s.state + b.s.city + b.s.name); });

    this.renderFeature();

    // status line
    var vt = this.varSel.value ? this.varSel.options[this.varSel.selectedIndex].text : "";
    var pt = this.prodSel.value ? this.prodSel.options[this.prodSel.selectedIndex].text : "";
    var what = pt && vt ? pt + " – " + vt : pt || (vt ? (this.brandSel.value ? this.brandSel.value + " " : "") + vt
      : (this.brandSel.value || "our products"));
    this.status.innerHTML = "";
    if (nq) {
      this.status.appendChild(el("span", {}, [el("b", { text: rows.length + (rows.length === 1 ? " store" : " stores") }),
        " named \u201c" + this.q.value.trim() + "\u201d" + (ok ? " carrying " + what : "") + ". ",
        el("a", { href: "#", text: "Show all", onclick: function (e) { e.preventDefault(); self.q.value = ""; self.nameQuery = ""; self.render(true); } })]));
    } else if (o) {
      this.status.appendChild(el("span", {}, [el("b", { text: rows.length + (rows.length === 1 ? " store" : " stores") }),
        " carrying " + what + (radius ? " within " + radius + " mi of " : " near ") + o.label]));
    } else {
      this.status.appendChild(el("span", {}, [el("b", { text: rows.length + (rows.length === 1 ? " store" : " stores") }),
        " carrying " + what + ". Enter a ZIP to sort by distance."]));
    }

    // list
    this.list.innerHTML = "";
    this.markers = {};
    this.layer.clearLayers();
    if (!rows.length) {
      var msg = nq ? "That store doesn't carry this selection. Try All brands." :
        o && radius && total ? "No stores within " + radius + " miles yet. Try a wider distance." :
        "No stores match these filters yet.";
      this.list.appendChild(el("div", { class: "pl-empty" }, [msg]));
    }

    var b = this.brandSel.value, t = this.prodSel.value, v = this.varSel.value;
    rows.forEach(function (r) {
      var s = r.s;
      var carried = s.products.map(function (x) { return self.prodById[x]; }).filter(function (p) {
        return p && (!ok || ok[p.id]);
      });
      var chips = el("div", { class: "pl-chips" });
      var showN = 5;
      function drawChips(n) {
        chips.innerHTML = "";
        carried.slice(0, n).forEach(function (p) {
          chips.appendChild(el("span", { class: "pl-chip", text: v && !t ? (b ? p.type : p.brand + " " + p.type.replace(new RegExp("^" + p.brand + "\\s*"), "")) : t && p.variant ? p.variant : p.name }));
        });
        if (carried.length > n) chips.appendChild(el("span", { class: "pl-chip pl-more", text: "+" + (carried.length - n) + " more",
          onclick: function (e) { e.stopPropagation(); drawChips(carried.length); } }));
      }
      drawChips(showN);

      var full = s.address + ", " + s.city + ", " + s.state + " " + s.zip;
      var dir = "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(s.name + ", " + full);
      var links = el("div", { class: "pl-links" }, [
        el("a", { href: dir, target: "_blank", rel: "noopener", text: "Directions", onclick: function (e) { e.stopPropagation(); } }),
        s.phone ? el("a", { href: "tel:" + s.phone.replace(/[^\d+]/g, ""), text: fmtPhone(s.phone), onclick: function (e) { e.stopPropagation(); } }) : null,
        s.website ? el("a", { href: /^https?:/.test(s.website) ? s.website : "https://" + s.website, target: "_blank", rel: "noopener", text: "Website", onclick: function (e) { e.stopPropagation(); } }) : null
      ]);
      var card = el("div", { class: "pl-card", tabindex: "0", "data-id": s.id }, [
        el("div", { class: "pl-top" }, [el("p", { class: "pl-name", text: s.name }),
          r.d != null ? el("span", { class: "pl-dist", text: r.d.toFixed(r.d < 10 ? 1 : 0) + " mi" }) : null]),
        el("div", { class: "pl-addr", text: full }),
        carried.length ? chips : null,
        links
      ]);
      card.addEventListener("click", function () { self.focus(s.id, true); });
      card.addEventListener("keydown", function (e) { if (e.key === "Enter") self.focus(s.id, true); });
      self.list.appendChild(card);

      var counts = {}, top = null;
      carried.forEach(function (p) { counts[p.brand] = (counts[p.brand] || 0) + 1; if (!top || counts[p.brand] > counts[top]) top = p.brand; });
      var logo = top ? (self.data.brand_images || {})[top] : "";
      if (logo && !/^(https?:|data:)/.test(logo)) logo = scriptBase + logo;
      var pin = '<div class="pl-pin">' + (logo ? '<img alt="" src="' + logo.replace(/"/g, "&quot;") + '">' : "") + "</div>";
      var m = L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: "pl-pin-wrap", html: pin, iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -16] }),
        title: s.name, riseOnHover: true
      }).bindPopup('<div class="pl-pop"><b></b><span></span></div>');
      m.on("popupopen", function (e) {
        var c = e.popup.getElement();
        c.querySelector("b").textContent = s.name;
        c.querySelector("span").textContent = s.address + ", " + s.city;
      });
      m.on("click", function () { self.focus(s.id, false); });
      m.addTo(self.layer);
      self.markers[s.id] = { m: m, card: card };
    });

    if (o) {
      L.circleMarker([o.lat, o.lng], { radius: 6, weight: 3, color: "#2b7bff", fillColor: "#fff", fillOpacity: 1 }).addTo(this.layer);
    }

    if (fit) {
      var pts = rows.slice(0, o ? 15 : rows.length).map(function (r) { return [r.s.lat, r.s.lng]; });
      if (o) pts.push([o.lat, o.lng]);
      if (pts.length === 1) this.map.setView(pts[0], 12);
      else if (pts.length) this.map.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
      else if (o) this.map.setView([o.lat, o.lng], 10);
    }
    setTimeout(function () { self.map.invalidateSize(); }, 50);
  };

  function pinEl(m) { var e = m.getElement && m.getElement(); return e && e.querySelector(".pl-pin"); }

  // Product photo / brand logo for the current selection
  Locator.prototype.renderFeature = function () {
    var d = this.data, b = this.brandSel.value, t = this.prodSel.value, v = this.varSel.value;
    var ok = this.wanted(), ps = ok ? d.products.filter(function (p) { return ok[p.id]; }) : [];
    var img = "", title = "", sub = "", imgs = null;
    var withImg = ps.filter(function (p) { return p.image; })[0];
    if (v && ps.length) {
      title = ps[0].variant;
      sub = t ? ps[0].type : "Available in " + ps.length + (ps.length === 1 ? " product" : " products");
      img = withImg ? withImg.image : "";
      var sticker = false;
      if (!t) {  // strain picked on its own: use the brand's strain artwork if there is one
        var si = d.strain_images || {};
        var brands = b ? [b] : ps.map(function (p) { return p.brand; });
        for (var i = 0; i < brands.length; i++) {
          var m = si[brands[i]] || {}, hit = null;
          for (var k in m) if (norm(k) === v) hit = m[k];
          if (hit) { img = hit; sticker = true; break; }
        }
        if (!sticker) {  // no artwork: show each product's photo (up to 3)
          var seenI = {};
          imgs = ps.filter(function (p) { return p.image && !seenI[p.image] && (seenI[p.image] = 1); })
                   .slice(0, 3).map(function (p) { return { src: p.image, alt: p.type }; });
          if (imgs.length < 2) imgs = null;
        }
      }
    } else if (t && ps.length) {
      title = ps[0].type;
      var n = ps.filter(isStrain).length;
      sub = n ? n + (n === 1 ? " strain" : " strains") : ps[0].brand;
      var generic = (d.type_images || {})[ps[0].type];
      img = generic || (withImg ? withImg.image : "");
    } else if (b) {
      title = b; sub = ps.length + " products";
    }
    if (!title) { this.feat.hidden = true; return; }
    var brand = b || (t ? t.split("||")[0] : (ps[0] ? ps[0].brand : ""));
    if (!img) img = (d.brand_images || {})[brand] || "";
    if (img && !/^(https?:|data:)/.test(img)) img = scriptBase + img;
    this.feat.innerHTML = "";
    if (!imgs && img) imgs = [{ src: img, alt: title }];
    if (imgs) {
      var box = el("div", { class: "pl-imgs" + (imgs.length > 1 ? " pl-multi" : "") });
      imgs.forEach(function (x) {
        var src = /^(https?:|data:)/.test(x.src) ? x.src : scriptBase + x.src;
        var im = el("img", { src: src, alt: x.alt, title: x.alt, loading: "lazy" });
        im.onerror = function () { im.remove(); };
        box.appendChild(im);
      });
      this.feat.appendChild(box);
    }
    this.feat.appendChild(el("div", {}, [el("div", { class: "pl-ft", text: title }), sub ? el("div", { class: "pl-fs", text: sub }) : null]));
    this.feat.hidden = false;
  };

  Locator.prototype.focus = function (id, fromList) {
    var x = this.markers[id];
    if (!x) return;
    var prev = this.activeId && this.markers[this.activeId];
    if (prev) { prev.card.classList.remove("pl-on"); pinEl(prev.m) && pinEl(prev.m).classList.remove("pl-on"); }
    this.activeId = id;
    x.card.classList.add("pl-on");
    if (pinEl(x.m)) pinEl(x.m).classList.add("pl-on");
    x.m.setZIndexOffset(1000);
    if (prev && prev !== x) prev.m.setZIndexOffset(0);
    if (fromList) {
      this.map.setView(x.m.getLatLng(), Math.max(this.map.getZoom(), 13));
      x.m.openPopup();
    } else {
      x.card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };

  // ------------------------------------------------------------ boot
  function boot() {
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    loadCSS(LEAFLET_CSS);
    var roots = document.querySelectorAll("#product-locator, [data-product-locator]");
    Array.prototype.forEach.call(roots, function (r) { if (!r.__pl) r.__pl = new Locator(r); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
