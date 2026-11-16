# Product Locator

A store locator for the website, built from LeafLink wholesale orders and refreshed daily.

- `sync/sync.py` pulls orders, products, brands and customers from the LeafLink API and writes `docs/stores.json`.
- `.github/workflows/sync.yml` runs the sync every day (around 5am Eastern) and commits the new data.
- `docs/` is served by GitHub Pages: `locator.js` (the widget), `stores.json` (the data) and `index.html` (a preview page).
- `config.json` holds the settings you can change without touching code.

## Embed in Squarespace

Add a **Code** block to the page and paste:

```html
<div id="product-locator" data-accent="#1a1a1a"></div>
<script src="https://YOUR-GITHUB-USERNAME.github.io/product-locator/locator.js" defer></script>
```

Optional attributes on the `<div>`:
- `data-accent`: button and pin colour (any hex colour).
- `data-brand="Sesh"`: opens with a brand already selected. Useful for a separate page per brand.
- `data-height="700"`: widget height on desktop, in pixels.

Links can also preselect filters, which is handy for Instagram bios and posts:
`yoursite.com/find-us?brand=Sesh` or `?brand=Oil&product=Classic%20Cart%201g`

## Settings (`config.json`)

| Setting | What it does |
|---|---|
| `lookback_days` | A store appears for a product if it ordered that product within this many days. Default 90. |
| `order_statuses` | Which LeafLink order statuses count as a real order. |
| `include_brands` | Leave empty for all brands, or list brand names to show only those. |
| `exclude_customer_ids` / `exclude_customer_names` | Accounts that should never appear (e.g. a store that asked to be left off). |
| `exclude_license_type_keywords` | Hides non-retail accounts such as distributors and processors. |
| `hide_products_containing` | Keeps samples, displays and testers out of the product list. |
| `name_overrides` | Rename a store, e.g. `"Spff Colo": "The Real Store Name"`. Use the name as it currently shows in the locator. |
| `location_overrides` | Exact map pins for stores whose address can't be looked up, e.g. `"Outcrop Dispensary": [37.68, -106.35]`. |

Edit the file on github.com (pencil icon) and commit. The change applies on the next run, or immediately if you use **Actions → Refresh product locator → Run workflow**.

## Running it by hand

```bash
python3 sync/sync.py --key-file ~/Documents/product-locator/leaflink_key.txt
```

Add `--dump-raw /some/folder` to save the raw LeafLink responses for troubleshooting.

## Where the key lives

The LeafLink key is stored only as the GitHub secret `LEAFLINK_API_KEY` (Settings → Secrets and variables → Actions). It never goes on the website. To rotate it, create a new app in LeafLink, update the secret, then delete the old app.

## Notes

- Locations come from the LeafLink customer record (delivery address preferred). Missing coordinates are looked up once with the free US Census geocoder and cached in `data/geocache.json`.
- ZIP search on the website uses zippopotam.us; city search uses OpenStreetMap. Neither needs an account.
- Map tiles: OpenStreetMap via CARTO. Fine for normal site traffic; if traffic grows a lot, switch to a keyed tile provider.
