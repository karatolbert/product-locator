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
    ".pl-head{background:var(--pl-soft);border-bottom:1px solid var(--pl-line)}",
    ".pl-rail{display:flex;gap:18px;padding:16px 16px 4px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}",
    ".pl-rail::-webkit-scrollbar{display:none}",
    ".pl-logo{flex:none;display:flex;flex-direction:column;align-items:center;gap:7px;background:none;border:0;padding:4px 2px;margin:0;cursor:pointer;font:inherit;font-size:12px;letter-spacing:.01em;color:var(--pl-muted);-webkit-tap-highlight-color:transparent}",
    ".pl-lc{width:60px;height:60px;border-radius:50%;overflow:hidden;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.08),0 2px 6px rgba(0,0,0,.08);transition:transform .18s,box-shadow .18s,opacity .18s,filter .18s;display:flex;align-items:center;justify-content:center}",
    ".pl-lc img{width:100%;height:100%;object-fit:cover;display:block}",
    ".pl-logo:hover .pl-lc{transform:translateY(-2px);box-shadow:0 0 0 1px rgba(0,0,0,.08),0 6px 14px rgba(0,0,0,.14)}",
    ".pl-logo:focus-visible{outline:none}.pl-logo:focus-visible .pl-lc{box-shadow:0 0 0 2px #fff,0 0 0 4px var(--pl-accent)}",
    ".pl-logo.pl-sel .pl-lc{box-shadow:0 0 0 2px #fff,0 0 0 4px var(--pl-accent),0 6px 14px rgba(0,0,0,.14)}",
    ".pl-logo.pl-sel span{color:#1a1a1a;font-weight:700}",
    ".pl-rail.pl-has-sel .pl-logo:not(.pl-sel) .pl-lc{opacity:.5;filter:grayscale(.7)}",
    ".pl-rail.pl-has-sel .pl-logo:not(.pl-sel):hover .pl-lc{opacity:.9;filter:none}",
    ".pl-all{background:var(--pl-accent);color:#fff;font-weight:700;font-size:15px;letter-spacing:.02em}",
    ".pl-bar{display:grid;grid-template-columns:1fr 120px;gap:10px;padding:12px 16px 12px}",
    ".pl-pick{border-top:1px solid var(--pl-line);background:#fff;display:grid;grid-template-columns:214px 1fr}",
    ".pl-pmain{min-width:0}",
    ".pl-types{border-right:1px solid var(--pl-line);padding:12px 10px 14px 14px;display:flex;flex-direction:column;gap:2px}",
    ".pl-types-h{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--pl-muted);padding:4px 6px 6px}",
    ".pl-type{display:flex;align-items:center;gap:8px;padding:6px;border-radius:8px;cursor:pointer;font-size:13.5px;color:#1a1a1a;user-select:none}",
    ".pl-type:hover{background:var(--pl-soft)}",
    ".pl-type input{position:absolute;opacity:0;width:1px;height:1px}",
    ".pl-type input:focus-visible+.pl-tbox{outline:2px solid var(--pl-accent);outline-offset:2px}",
    ".pl-tbox{flex:none;width:18px;height:18px;border-radius:5px;border:1.5px solid #c4c4c4;background:#fff;display:flex;align-items:center;justify-content:center}",
    ".pl-tbox svg{width:12px;height:12px;opacity:0}",
    ".pl-type.pl-sel .pl-tbox{background:var(--pl-accent);border-color:var(--pl-accent)}.pl-type.pl-sel .pl-tbox svg{opacity:1}",
    ".pl-type.pl-sel{font-weight:600}",
    ".pl-ticn{flex:none;width:24px;height:24px;color:#333}.pl-ticn svg{width:24px;height:24px}",
    ".pl-ph{display:flex;align-items:center;gap:10px;padding:10px 16px;flex-wrap:wrap}",
    ".pl-tabs{display:inline-flex;background:var(--pl-soft);border:1px solid var(--pl-line);border-radius:999px;padding:3px}",
    ".pl-tab{border:0;background:none;font:inherit;font-size:14px;font-weight:600;color:var(--pl-muted);padding:7px 14px;border-radius:999px;cursor:pointer;white-space:nowrap}",
    ".pl-tab.pl-sel{background:#fff;color:#1a1a1a;box-shadow:0 1px 3px rgba(0,0,0,.12)}",
    ".pl-tab i{font-style:normal;display:inline-block;min-width:18px;height:18px;line-height:18px;border-radius:9px;background:var(--pl-accent);color:#fff;font-size:11px;margin-left:6px;padding:0 5px}",
    ".pl-pf{flex:1;min-width:160px;max-width:260px;height:36px!important;font-size:14px!important}",
    ".pl-clear{border:0;background:none;font:inherit;font-size:13px;font-weight:600;color:var(--pl-accent);text-decoration:underline;cursor:pointer;padding:4px}",
    ".pl-toggle{margin-left:auto;border:0;background:none;font:inherit;font-size:13px;color:var(--pl-muted);cursor:pointer;padding:4px}",
    ".pl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:10px;padding:2px 16px 16px;max-height:292px;overflow-y:auto}",
    ".pl-pick.pl-closed .pl-grid,.pl-pick.pl-closed .pl-pf{display:none}",
    ".pl-tile{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 8px 9px;border:1px solid var(--pl-line);border-radius:12px;background:#fff;cursor:pointer;font:inherit;text-align:center;transition:border-color .15s,box-shadow .15s,transform .15s}",
    ".pl-tile:hover{border-color:#cfcfcf;box-shadow:0 3px 10px rgba(0,0,0,.08);transform:translateY(-1px)}",
    ".pl-tile.pl-sel{border-color:var(--pl-accent);box-shadow:0 0 0 1px var(--pl-accent)}",
    ".pl-tile .pl-ti{width:84px;height:84px;object-fit:contain;border-radius:10px;background:var(--pl-soft)}",
    ".pl-tile .pl-tn{font-size:12.5px;font-weight:600;line-height:1.25;color:#1a1a1a;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
    ".pl-tile .pl-tb{font-size:11px;color:var(--pl-muted);margin-top:-3px}",
    ".pl-check{position:absolute;top:7px;right:7px;width:20px;height:20px;border-radius:6px;border:1.5px solid #c9c9c9;background:#fff;display:flex;align-items:center;justify-content:center}",
    ".pl-tile.pl-sel .pl-check{background:var(--pl-accent);border-color:var(--pl-accent)}",
    ".pl-check svg{width:13px;height:13px;opacity:0}.pl-tile.pl-sel .pl-check svg{opacity:1}",
    ".pl-shopby{font-size:13px;font-weight:600;color:var(--pl-muted)}",
    ".pl-ticon{display:flex;align-items:center;justify-content:center;border-radius:50%!important;color:#1a1a1a}",
    ".pl-ticon svg{width:56px;height:56px}",
    ".pl-tile.pl-sel .pl-ticon{background:var(--pl-accent);color:#fff}",
    ".pl-mini{display:flex;gap:4px;justify-content:center;color:#4a4a4a;margin-top:-1px}",
    ".pl-mini svg{width:21px;height:21px;stroke-width:3.2}",
    ".pl-gempty{grid-column:1/-1;color:var(--pl-muted);font-size:14px;padding:14px 4px}",
    ".pl-search{display:flex;gap:6px}",
    ".pl input,.pl select{width:100%;height:42px;border:1px solid var(--pl-line);border-radius:9px;padding:0 12px;font:inherit;font-size:15px;background:#fff;color:inherit;margin:0;-webkit-appearance:none;appearance:none}",
    ".pl select:disabled{opacity:.5;cursor:not-allowed}.pl select{background-image:linear-gradient(45deg,transparent 50%,#888 50%),linear-gradient(135deg,#888 50%,transparent 50%);background-position:calc(100% - 17px) 18px,calc(100% - 12px) 18px;background-size:5px 5px;background-repeat:no-repeat;padding-right:30px;text-overflow:ellipsis}",
    ".pl input:focus,.pl select:focus{outline:2px solid var(--pl-accent);outline-offset:-1px}",
    ".pl-btn{height:42px;min-width:42px;border:0;border-radius:9px;background:var(--pl-accent);color:#fff;font:inherit;font-size:14px;font-weight:600;padding:0 14px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:6px}",
    ".pl-btn.pl-ghost{background:#fff;color:var(--pl-accent);border:1px solid var(--pl-line)}",
    ".pl-btn svg{width:18px;height:18px}",
    ".pl-go svg{display:none}",
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
    ".pl-pin{display:flex;align-items:center;justify-content:center;width:100%;height:100%;transition:transform .15s}",
    ".pl-dot{flex:none;width:34px;height:34px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);overflow:hidden;background:var(--pl-accent);position:relative}",
    ".pl-pin.pl-multi .pl-dot{width:28px;height:28px}",
    ".pl-pin.pl-multi .pl-dot+.pl-dot{margin-left:-11px}",
    ".pl-dot img{width:100%;height:100%;object-fit:cover;display:block}",
    ".pl-pin.pl-on{transform:scale(1.3)}",
    ".pl-pin.pl-on .pl-dot{box-shadow:0 2px 8px rgba(0,0,0,.45)}",
    ".pl-pin-wrap{background:none;border:0}",
    ".pl-empty{padding:30px 20px;text-align:center;color:var(--pl-muted)}",
    ".pl-note{display:flex;gap:10px;align-items:flex-start;padding:11px 16px;background:#fff6d9;border-bottom:1px solid #f0dc9c;color:#5a4610;font-size:14px;line-height:1.4}",
    ".pl-note svg{flex:none;width:18px;height:18px;margin-top:1px}",
    ".pl-note b{color:#3d2f05}",
    ".pl-foot{padding:9px 16px;font-size:12px;color:var(--pl-muted);border-top:1px solid var(--pl-line);background:var(--pl-soft)}",
    ".pl .leaflet-popup-content{font-family:inherit;font-size:14px;margin:12px 14px}",
    ".pl-pop b{display:block;font-size:15px;margin-bottom:2px}",
    "@media (max-width:860px){.pl-bar{grid-template-columns:1fr 104px}.pl-search{grid-column:1/-1}",
    ".pl-rail{gap:12px;padding:14px 14px 2px;-webkit-mask-image:linear-gradient(90deg,#000 85%,transparent);mask-image:linear-gradient(90deg,#000 85%,transparent)}",
    ".pl-lc{width:52px;height:52px}.pl-logo{font-size:11px}",
    ".pl-bar{padding:10px 14px 12px}",
    ".pl-ph{padding:10px 14px;gap:8px}.pl-pf{max-width:none;order:5;flex-basis:100%}",
    ".pl-pick{grid-template-columns:1fr}",
    ".pl-types{flex-direction:row;overflow-x:auto;border-right:0;border-bottom:1px solid var(--pl-line);padding:10px 14px;gap:6px;scrollbar-width:none}",
    ".pl-types::-webkit-scrollbar{display:none}.pl-types-h{display:none}",
    ".pl-type{flex:none;border:1px solid var(--pl-line);border-radius:999px;padding:5px 11px 5px 7px;font-size:13px}",
    ".pl-type .pl-tbox{display:none}.pl-type.pl-sel{background:var(--pl-accent);border-color:var(--pl-accent);color:#fff}.pl-type.pl-sel .pl-ticn{color:#fff}",
    ".pl-ticn,.pl-ticn svg{width:20px;height:20px}",
    ".pl-tab{font-size:13.5px;padding:7px 11px}",
    ".pl-bar{grid-template-columns:1fr 82px!important}.pl-bar .pl-search{grid-column:auto!important;min-width:0}",
    ".pl-search input{min-width:0}.pl-bar select{padding-right:24px;background-position:calc(100% - 15px) 18px,calc(100% - 10px) 18px}",
    ".pl-grid{grid-template-columns:repeat(auto-fill,minmax(98px,1fr));gap:8px;padding:2px 14px 14px;max-height:260px}",
    ".pl-tile .pl-ti{width:68px;height:68px}.pl-ticon svg{width:46px;height:46px}.pl-shopby{display:none}",
    ".pl-bar .pl-prod{grid-column:1/-1;order:2}.pl-bar .pl-var{grid-column:auto;order:3}.pl-bar>select:last-child{order:4}",
    ".pl-go span{display:none}.pl-go svg{display:block!important}",
    ".pl-search input{padding:0 10px}.pl-search input::placeholder{font-size:13.5px}",
    ".pl-body{grid-template-columns:1fr;grid-template-rows:300px auto;height:auto}",
    ".pl-map{order:-1;height:300px}.pl-side{border-right:0}.pl-list{max-height:none}}"
  ].join("");

  var ICON_LOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/></svg>';

  // Oil Twists is its own line on the website, though LeafLink files it under Oil.
  function splitTwists(d) {
    var any = false;
    d.products.forEach(function (p) {
      if (p.brand === "Oil" && /^Oil Twists/i.test(p.type)) { p.brand = "Oil Twists"; any = true; }
    });
    if (!any) return;
    var i = d.brands.indexOf("Oil");
    if (d.brands.indexOf("Oil Twists") < 0) d.brands.splice(i < 0 ? d.brands.length : i + 1, 0, "Oil Twists");
    d.brand_images = d.brand_images || {};
    if (!d.brand_images["Oil Twists"]) d.brand_images["Oil Twists"] = "img/brands/oil-twists.jpg";
    d.strain_images = d.strain_images || {};
    if (!d.strain_images["Oil Twists"]) d.strain_images["Oil Twists"] = d.strain_images["Oil"] || {};
  }

  // Brand order on the logo row (others follow alphabetically). data-brand-order="Oil, Sesh, ..." overrides.
  var BRAND_ORDER = ["Oil", "Oil Twists", "Sesh", "Panacea", "Wisenheimer", "Boost!"];
  function orderBrands(d, custom) {
    var order = custom ? custom.split(",").map(function (x) { return x.trim(); }) : BRAND_ORDER;
    var rank = function (b) { var i = order.indexOf(b); return i < 0 ? 999 : i; };
    d.brands.sort(function (a, b) { return rank(a) - rank(b) || a.localeCompare(b); });
  }

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
    var mq = window.matchMedia ? window.matchMedia("(max-width: 480px)") : null;
    var setPh = function () {
      self.q.placeholder = mq && mq.matches ? "ZIP, city, store" : "ZIP code, city, or dispensary name";
    };
    setPh();
    if (mq && mq.addEventListener) mq.addEventListener("change", setPh);
    var go = el("button", { class: "pl-btn pl-go", type: "button", "aria-label": "Search", onclick: function () { self.search(); },
      html: '<span>Search</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' });
    var me = el("button", { class: "pl-btn pl-ghost", type: "button", title: "Use my location", "aria-label": "Use my location",
      html: ICON_LOC, onclick: function () { self.locate(); } });
    this.brandSel = el("select", { "aria-hidden": "true", tabindex: "-1", style: "display:none" });
    this.selCats = {};       // "cart" / "aio" / ... -> true
    this.selTypes = {};      // "Brand||Type" -> true
    this.selStrains = {};    // normalised strain -> display name
    this.tab = "product";
    this.pickFilter = "";
    this.radiusSel = el("select", { "aria-label": "Distance", onchange: function () { self.render(true); } });
    [["10", "10 mi"], ["25", "25 mi"], ["50", "50 mi"], ["100", "100 mi"], ["0", "Any distance"]].forEach(function (o) {
      self.radiusSel.appendChild(el("option", { value: o[0], text: o[1] }));
    });
    this.radiusSel.value = "25";

    this.feat = el("div", { class: "pl-feat", hidden: "" });
    this.status = el("div", { class: "pl-status", "aria-live": "polite", text: "Loading stores…" });
    this.list = el("div", { class: "pl-list" });
    this.mapEl = el("div", { class: "pl-map" });
    this.note = el("div", { class: "pl-note", role: "note", html:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
      '<span><b>Please call the store before you go.</b> This map shows shops that recently ordered our products. It is not a live inventory, so items may have sold out.</span>' });
    this.foot = el("div", { class: "pl-foot" });

    this.rail = el("div", { class: "pl-rail", role: "group", "aria-label": "Filter by brand" });
    r.appendChild(el("div", { class: "pl-head" }, [
      this.rail,
      el("div", { class: "pl-bar" }, [
        el("div", { class: "pl-search" }, [this.q, go, me]),
        this.radiusSel
      ]),
      this.buildPicker()
    ]));
    r.appendChild(this.note);
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
      splitTwists(self.data);
      orderBrands(self.data, self.root.getAttribute("data-brand-order"));
      self.prodById = {};
      self.data.products.forEach(function (p) { self.prodById[p.id] = p; });
      self.initMap();
      self.fillBrands();
      self.render(true);
      var d = new Date(self.data.updated);
      self.foot.textContent = "Based on wholesale orders from the last " + self.data.lookback_days +
        " days. Availability not guaranteed. Updated " +
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

  Locator.prototype.pickBrand = function (b) {
    this.brandSel.value = this.brandSel.value === b ? "" : b;   // click again to clear
    this.refresh(); this.render(true);
  };

  Locator.prototype.renderRail = function () {
    var self = this, cur = this.brandSel.value, imgs = this.data.brand_images || {};
    this.rail.innerHTML = "";
    this.rail.classList.toggle("pl-has-sel", !!cur);
    var all = el("button", { type: "button", class: "pl-logo" + (cur ? "" : " pl-sel"), "aria-pressed": String(!cur),
      onclick: function () { self.brandSel.value = ""; self.refresh(); self.render(true); } },
      [el("div", { class: "pl-lc pl-all", text: "All" }), el("span", { text: "All brands" })]);
    this.rail.appendChild(all);
    this.data.brands.forEach(function (b) {
      var src = imgs[b] || "";
      if (src && !/^(https?:|data:)/.test(src)) src = scriptBase + src;
      var lc = el("div", { class: "pl-lc" }, [src ? el("img", { src: src, alt: "" }) : el("b", { text: b.charAt(0) })]);
      self.rail.appendChild(el("button", { type: "button", class: "pl-logo" + (cur === b ? " pl-sel" : ""), "aria-pressed": String(cur === b),
        title: b, onclick: function () { self.pickBrand(b); } }, [lc, el("span", { text: b })]));
    });
  };

  Locator.prototype.fillBrands = function () {
    var s = this.brandSel, self = this, d = this.data;
    s.innerHTML = "";
    s.appendChild(el("option", { value: "", text: "All brands" }));
    d.brands.forEach(function (b) { s.appendChild(el("option", { value: b, text: b })); });
    var want = d.brands.filter(function (b) { return norm(b) === norm(self.initBrand); })[0];
    if (want) s.value = want;
    var q = norm(this.initProduct);
    if (q) {
      var p = d.products.filter(function (p) { return p.id === q || norm(p.name) === q; })[0];
      var t = p || d.products.filter(function (p) { return norm(p.type) === q; })[0];
      if (t) { this.selTypes[t.brand + "||" + t.type] = true; if (!want) s.value = t.brand; }
      if (p && isStrain(p)) { this.selStrains[norm(p.variant)] = p.variant; this.tab = "strain"; }
    }
    if (this.initStrain) {
      var hit = d.products.filter(function (p) { return isStrain(p) && norm(p.variant) === norm(self.initStrain); })[0];
      if (hit) { this.selStrains[norm(hit.variant)] = hit.variant; this.tab = "strain"; }
    }
    this.refresh();
  };

  function isStrain(p) {
    return p.variant && !/battery|variety|sampler/i.test(p.type + " " + p.variant);
  }
  function count(o) { return Object.keys(o).length; }
  function resolve(src) { return !src || /^(https?:|data:)/.test(src) ? src : scriptBase + src; }

  // Products / strains that fit the brand and the other tab's picks
  Locator.prototype.typeOptions = function () {
    var self = this, b = this.brandSel.value, ss = this.selStrains, out = {}, order = [];
    this.data.products.forEach(function (p) {
      if (b && p.brand !== b) return;
      var k = p.brand + "||" + p.type;
      if (count(ss) && !(isStrain(p) && ss[norm(p.variant)]) && !self.selTypes[k]) return;
      if (count(self.selCats) && !inCats(p, self.selCats) && !self.selTypes[k]) return;
      if (!out[k]) { out[k] = { key: k, brand: p.brand, type: p.type, items: [] }; order.push(k); }
      out[k].items.push(p);
    });
    return order.map(function (k) { return out[k]; });
  };
  Locator.prototype.catOptions = function () {
    var b = this.brandSel.value, ss = this.selStrains, self = this, found = {};
    this.data.products.forEach(function (p) {
      if (b && p.brand !== b) return;
      if (count(ss) && !(isStrain(p) && ss[norm(p.variant)])) return;
      catsOf(p.type).forEach(function (k) { (found[k] = found[k] || []).push(p); });
    });
    return CATS.filter(function (c) { return found[c.key] || self.selCats[c.key]; })
      .map(function (c) { return { key: c.key, name: c.name, items: found[c.key] || [] }; });
  };

  Locator.prototype.strainOptions = function () {
    var self = this, b = this.brandSel.value, st = this.selTypes, out = {}, order = [];
    this.data.products.forEach(function (p) {
      if (!isStrain(p)) return;
      if (b && p.brand !== b) return;
      var k = norm(p.variant);
      if (count(st) && !st[p.brand + "||" + p.type] && !self.selStrains[k]) return;
      if (count(self.selCats) && !inCats(p, self.selCats) && !self.selStrains[k]) return;
      if (!out[k]) { out[k] = { key: k, name: p.variant, items: [] }; order.push(k); }
      out[k].items.push(p);
    });
    return order.map(function (k) { return out[k]; }).sort(function (a, c) { return a.name.localeCompare(c.name); });
  };

  // Drop picks that no longer fit (e.g. after changing brand)
  // Picks only drop when the brand changes and they don't belong to it
  Locator.prototype.refresh = function () {
    var self = this, b = this.brandSel.value;
    if (!b) return;
    var cats = {};
    this.data.products.forEach(function (p) { if (p.brand === b) catsOf(p.type).forEach(function (k) { cats[k] = 1; }); });
    Object.keys(this.selCats).forEach(function (k) { if (!cats[k]) delete self.selCats[k]; });
    Object.keys(this.selTypes).forEach(function (k) { if (k.split("||")[0] !== b) delete self.selTypes[k]; });
    var inBrand = {};
    this.data.products.forEach(function (p) { if (p.brand === b && isStrain(p)) inBrand[norm(p.variant)] = 1; });
    Object.keys(this.selStrains).forEach(function (k) { if (!inBrand[k]) delete self.selStrains[k]; });
  };

  Locator.prototype.wanted = function () {
    var b = this.brandSel.value, sc = this.selCats, st = this.selTypes, ss = this.selStrains;
    if (!b && !count(sc) && !count(st) && !count(ss)) return null;
    var ok = {};
    this.data.products.forEach(function (p) {
      if (b && p.brand !== b) return;
      if (count(sc) && !inCats(p, sc)) return;
      if (count(st) && !st[p.brand + "||" + p.type]) return;
      if (count(ss) && !(isStrain(p) && ss[norm(p.variant)])) return;
      ok[p.id] = 1;
    });
    return ok;
  };

  Locator.prototype.buildPicker = function () {
    var self = this;
    this.pick = el("div", { class: "pl-pick" });
    function go(t) { return function () { self.tab = t; self.pickFilter = ""; self.pf.value = ""; self.open(); self.renderPicker(); }; }
    this.tabP = el("button", { type: "button", class: "pl-tab", onclick: go("product") });
    this.tabS = el("button", { type: "button", class: "pl-tab", onclick: go("strain") });
    this.pf = el("input", { type: "search", class: "pl-pf", placeholder: "Find a product",
      oninput: function () { self.pickFilter = norm(self.pf.value); self.renderPicker(); } });
    this.clearBtn = el("button", { type: "button", class: "pl-clear", text: "Clear picks",
      onclick: function () { self.selCats = {}; self.selTypes = {}; self.selStrains = {}; self.render(true); } });
    this.toggleBtn = el("button", { type: "button", class: "pl-toggle", onclick: function () {
      self.pick.classList.toggle("pl-closed"); self.renderPicker(); } });
    this.grid = el("div", { class: "pl-grid", role: "group" });
    this.pick.appendChild(el("div", { class: "pl-ph" }, [
      el("span", { class: "pl-shopby", text: "Shop by" }),
      el("div", { class: "pl-tabs", role: "tablist" }, [this.tabP, this.tabS]), this.pf, this.clearBtn, this.toggleBtn]));
    this.pick.appendChild(this.grid);
    this.typeBox = el("div", { class: "pl-types", role: "group", "aria-label": "Product type" });
    var main = el("div", { class: "pl-pmain" });
    while (this.pick.firstChild) main.appendChild(this.pick.firstChild);
    this.pick.appendChild(this.typeBox);
    this.pick.appendChild(main);
    return this.pick;
  };
  // Small checkbox list of device types, beside the Product / Strain grid
  Locator.prototype.renderTypes = function () {
    var self = this, box = this.typeBox, opts = this.catOptions();
    box.innerHTML = "";
    box.appendChild(el("div", { class: "pl-types-h", text: "Type" }));
    opts.forEach(function (o) {
      var on = !!self.selCats[o.key];
      var row = el("label", { class: "pl-type" + (on ? " pl-sel" : "") }, [
        el("input", { type: "checkbox", onchange: function () {
          if (self.selCats[o.key]) delete self.selCats[o.key]; else self.selCats[o.key] = true;
          self.refresh(); self.render(true); } }),
        el("span", { class: "pl-tbox", html: CHECK }),
        el("span", { class: "pl-ticn", html: ICONS[o.key] }),
        el("span", { class: "pl-tlabel", text: o.name })
      ]);
      row.querySelector("input").checked = on;
      box.appendChild(row);
    });
  };

  Locator.prototype.open = function () { this.pick.classList.remove("pl-closed"); };

  // Simple line icons for each kind of device (64x64, stroke = currentColor)
  function svg(body) {
    return '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' + body + "</svg>";
  }
  var ICONS = {
    cart: svg('<path d="M26 15v-4.5a6 6 0 0 1 12 0V15"/><path d="M24.5 15h15"/><rect x="23" y="15" width="18" height="29" rx="4"/><rect x="26" y="30" width="12" height="11" rx="2" fill="currentColor" opacity=".22" stroke="none"/><path d="M26 30h12"/><path d="M26.5 44v12h11V44"/><path d="M26.5 49h11M26.5 52.5h11"/>'),
    aio: svg('<path d="M25 5.5h14l2 9H23z"/><rect x="15" y="14.5" width="34" height="44" rx="6"/><rect x="25.5" y="22" width="13" height="18" rx="3"/><rect x="27.5" y="31" width="9" height="7" rx="1.5" fill="currentColor" opacity=".22" stroke="none"/><circle cx="32" cy="49.5" r="2.4"/>'),
    pack: svg('<rect x="8" y="16" width="48" height="40" rx="5"/><path d="M8 24h48"/>' +
      '<rect x="14" y="30" width="6" height="18" rx="2"/><rect x="24" y="30" width="6" height="18" rx="2"/>' +
      '<rect x="34" y="30" width="6" height="18" rx="2"/><rect x="44" y="30" width="6" height="18" rx="2"/><path d="M22 10h20"/>'),
    preroll: svg('<path d="M27.5 48 20 19M36.5 48 44 19"/><rect x="27" y="48" width="10" height="10" rx="2"/><path d="M27 52h10"/><path d="M20 19c2.5-4 7-7.5 10.5-10M44 19c-2.5-4-7-7.5-10.5-10"/><path d="M30.5 9c.8 1 2.2 1 3 0"/><path d="M30.5 9c-1.5-2.5 4.5-2.8 2.6-5.4-.8-1.1-.4-2.6 1.2-3"/>'),
    battery: svg('<path d="M28 9V4h8v5"/><rect x="25" y="9" width="14" height="50" rx="5"/><circle cx="32" cy="21" r="3"/>' +
      '<path d="M29 48h6M29 52h6" opacity=".7"/>'),
    syringe: svg('<path d="M23 5h18M32 5v10"/><rect x="25" y="15" width="14" height="32" rx="2.5"/>' +
      '<rect x="27.5" y="31" width="9" height="13.5" rx="1" fill="currentColor" opacity=".22" stroke="none"/>' +
      '<path d="M25 22h6M25 28h6M25 34h6M25 40h6"/><path d="M29.5 47v5h5v-5M32 52v8"/>')
  };
  // "Shop by type" groups. A product can sit in more than one (a cone variety pack is a pack and a pre-roll).
  var CATS = [
    { key: "cart", name: "Cartridges", test: function (t) { return /cartridge/i.test(t) && !/variety|pack/i.test(t); } },
    { key: "aio", name: "All-in-ones", test: function (t) { return /all.?in.?one|seshie/i.test(t); } },
    { key: "pack", name: "Variety packs", test: function (t) { return /variety|\bpack\b/i.test(t); } },
    { key: "preroll", name: "Infused pre-rolls", test: function (t) { return /cone|pre-?roll/i.test(t); } },
    { key: "battery", name: "Batteries", test: function (t) { return /battery/i.test(t); } },
    { key: "syringe", name: "Syringes", test: function (t) { return /syringe/i.test(t); } }
  ];
  function catsOf(type) { return CATS.filter(function (c) { return c.test(type); }).map(function (c) { return c.key; }); }
  function inCats(p, sel) { return catsOf(p.type).some(function (k) { return sel[k]; }); }
  function iconFor(type) { var k = catsOf(type)[0]; return k ? ICONS[k] : ""; }

  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  Locator.prototype.renderPicker = function () {
    var self = this, d = this.data, b = this.brandSel.value, f = this.pickFilter;
    var nc = count(this.selCats), nt = count(this.selTypes), ns = count(this.selStrains), me = this;
    [[this.tabP, "Product", nt, "product"], [this.tabS, "Strain", ns, "strain"]].forEach(function (x) {
      x[0].innerHTML = ""; x[0].appendChild(document.createTextNode(x[1]));
      if (x[2]) x[0].appendChild(el("i", { text: String(x[2]) }));
      x[0].classList.toggle("pl-sel", me.tab === x[3]);
    });
    this.pf.placeholder = this.tab === "product" ? "Find a product" : "Find a strain";
    this.clearBtn.hidden = !(nc || nt || ns);
    this.renderTypes();
    var closed = this.pick.classList.contains("pl-closed");
    this.toggleBtn.textContent = closed ? "Show options ▾" : "Hide ▴";
    if (closed) return;

    var grid = this.grid; grid.innerHTML = "";
    function tile(selected, img, name, sub, onclick, icon, minis) {
      var t = el("button", { type: "button", class: "pl-tile" + (selected ? " pl-sel" : ""), "aria-pressed": String(!!selected), title: name, onclick: onclick }, [
        el("span", { class: "pl-check", html: CHECK }),
        icon ? el("span", { class: "pl-ti pl-ticon", html: icon })
          : img ? el("img", { class: "pl-ti", src: resolve(img), alt: "", loading: "lazy" }) : el("span", { class: "pl-ti" }),
        el("span", { class: "pl-tn", text: name }),
        minis && minis.length ? el("span", { class: "pl-mini", html: minis.map(function (k) { return '<span title="' + k[1] + '">' + ICONS[k[0]] + "</span>"; }).join("") }) : null,
        sub ? el("span", { class: "pl-tb", text: sub }) : null
      ]);
      var im = t.querySelector("img"); if (im) im.onerror = function () { im.style.visibility = "hidden"; };
      grid.appendChild(t);
    }
    if (this.tab === "cat") {
      this.catOptions().forEach(function (o) {
        var bs = {}; o.items.forEach(function (p) { bs[p.brand] = 1; });
        var nb = Object.keys(bs).length;
        tile(self.selCats[o.key], "", o.name, b ? "" : nb + (nb === 1 ? " brand" : " brands"), function () {
          if (self.selCats[o.key]) delete self.selCats[o.key]; else self.selCats[o.key] = true;
          self.refresh(); self.render(true);
        }, ICONS[o.key]);
      });
    } else if (this.tab === "product") {
      var opts = this.typeOptions().filter(function (o) { return !f || norm(o.type).indexOf(f) >= 0; });
      opts.forEach(function (o) {
        var withImg = o.items.filter(function (p) { return p.image; })[0];
        var img = (d.type_images || {})[o.type] || (withImg ? withImg.image : "") || (d.brand_images || {})[o.brand];
        var label = o.type.replace(new RegExp("^" + o.brand.replace(/[.*+?^${}()|[\]\\!]/g, "\\$&") + "\\s+"), "");
        var n = o.items.filter(isStrain).length;
        tile(self.selTypes[o.key], img, label, (b ? "" : o.brand) + (n ? (b ? "" : " · ") + n + (n === 1 ? " strain" : " strains") : ""), function () {
          if (self.selTypes[o.key]) delete self.selTypes[o.key]; else self.selTypes[o.key] = true;
          self.refresh(); self.render(true);
        });
      });
      if (!opts.length) grid.appendChild(el("div", { class: "pl-gempty", text: "No products match." }));
    } else {
      var si = d.strain_images || {};
      var sopts = this.strainOptions().filter(function (o) { return !f || o.key.indexOf(f) >= 0; });
      sopts.forEach(function (o) {
        var art = "";
        o.items.some(function (p) { var m = si[p.brand] || {}; for (var k in m) if (norm(k) === o.key) { art = m[k]; return true; } return false; });
        var brands = {}; o.items.forEach(function (p) { brands[p.brand] = 1; });
        var bl = Object.keys(brands);
        var logo = (d.brand_images || {})[b || bl[0]] || "";
        var kinds = {}, minis = [];
        o.items.forEach(function (p) { var k = catsOf(p.type).filter(function (x) { return x !== "pack"; })[0] || catsOf(p.type)[0];
          if (k && !kinds[k]) { kinds[k] = 1; minis.push([k, CATS.filter(function (c) { return c.key === k; })[0].name]); } });
        tile(self.selStrains[o.key], art || logo, o.name, b ? "" : bl.join(", "), function () {
          if (self.selStrains[o.key]) delete self.selStrains[o.key]; else self.selStrains[o.key] = o.name;
          self.refresh(); self.render(true);
        }, "", minis);
      });
      if (!sopts.length) grid.appendChild(el("div", { class: "pl-gempty", text: "No strains match." }));
    }
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
    this.renderRail();
    this.renderPicker();

    // status line
    var picks = Object.keys(this.selCats).map(function (k) { return CATS.filter(function (c) { return c.key === k; })[0].name.toLowerCase(); })
      .concat(Object.keys(this.selTypes).map(function (k) { return k.split("||")[1]; })
      .concat(Object.keys(this.selStrains).map(function (k) { return self.selStrains[k]; })));
    var what = picks.length ? picks.slice(0, 2).join(" + ") + (picks.length > 2 ? " + " + (picks.length - 2) + " more" : "")
      : (this.brandSel.value || "our products");
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

    var b = this.brandSel.value, nT = count(this.selTypes), nS = count(this.selStrains);
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
          chips.appendChild(el("span", { class: "pl-chip", text: nS === 1 && !nT ? p.type : nT === 1 && !nS && p.variant ? p.variant : p.name }));
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

      // one logo per brand the store carries (most-carried first, up to 3)
      var counts = {};
      carried.forEach(function (p) { counts[p.brand] = (counts[p.brand] || 0) + 1; });
      var brandsHere = Object.keys(counts).sort(function (a, c) { return counts[c] - counts[a]; }).slice(0, 3);
      var dots = brandsHere.map(function (br, i) {
        var logo = (self.data.brand_images || {})[br] || "";
        if (logo && !/^(https?:|data:)/.test(logo)) logo = scriptBase + logo;
        return '<div class="pl-dot" style="z-index:' + (3 - i) + '" title="' + br.replace(/"/g, "&quot;") + '">' +
          (logo ? '<img alt="" src="' + logo.replace(/"/g, "&quot;") + '">' : "") + "</div>";
      });
      if (!dots.length) dots = ['<div class="pl-dot"></div>'];
      var n = dots.length, w = n === 1 ? 34 : 28 + (n - 1) * 17;
      var pin = '<div class="pl-pin' + (n > 1 ? " pl-multi" : "") + '">' + dots.join("") + "</div>";
      var m = L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: "pl-pin-wrap", html: pin, iconSize: [w, 34], iconAnchor: [w / 2, 17], popupAnchor: [0, -16] }),
        title: s.name, riseOnHover: true
      }).bindPopup('<div class="pl-pop"><b></b><span></span></div>', { minWidth: 200, maxWidth: 260 });
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
    var d = this.data, b = this.brandSel.value;
    var tk = Object.keys(this.selTypes), sk = Object.keys(this.selStrains);
    if (tk.length > 1 || sk.length > 1 || count(this.selCats)) { this.feat.hidden = true; return; }   // tiles already show the picks
    var t = tk[0] || "", v = sk[0] || "";
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
