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

## Versions

- `docs/locator.js` is the live widget (v3): brand-logo row, location search on top, Shop by Product / Strain picture tiles with multi-select, Type and Strain type checklists, shareable links, "Recently stocked" (shipped within 10 days), phone List / Map switch, distance-first start, Google Analytics events.
- `docs/locator-v2.js`: previous version (logo row with Product / Strain dropdowns).
- `docs/locator-v1.js`: first version (all dropdowns).

To go back, point the embed's script at one of the older files.

### Embed options (on the `<div>`)

- `data-accent="#1a1a1a"`: button and highlight colour.
- `data-brand="Sesh"` / `data-strain="Churroz"`: open with a brand or strain selected.
- `data-brands="Sesh"`: brand websites. Shows only that brand (the logo row is hidden). Several brands work too: `data-brands="Oil, Oil Twists"` shows a logo row with just those.
- `data-recent-days="10"`: how recent a shipped order must be for "Recently stocked".
- `data-brand-order="Oil, Oil Twists, Sesh, ..."`: order of the logo row.
- `data-update-url="false"`: stop the page address from following the filters.

### Analytics

If Google Analytics 4 (or Tag Manager) is on the page, the locator sends: `locator_search`, `locator_filter`, `locator_location`, `locator_sort`, `locator_view`, `locator_store_action`.

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
| `product_groups` | Combine several LeafLink products into one entry in the Product filter (e.g. Variety Pack #1, #2 and #3). |
| `brand_logos` | Logo shown when someone picks a brand. Images live in `docs/img/brands/`. |
| `strain_images` | Strain artwork per brand, shown when a strain is picked without a product. Images live in `docs/img/strains/`. |
| `default_strain_class` | Strain type (indica / sativa / hybrid) used when a strain has no tag in LeafLink. Set to `hybrid`. |
| `rename_products` | Show a product under a different name on the website, e.g. Wisenheimer Tugboat → Wisenheimer Live Rosin All In One (1g). |
| `remove_words` | Words dropped from every product name on the site (e.g. "Distillate"). |
| `image_recheck_days` | How often (days) to re-check LeafLink for changed product photos. Photos are copied into `docs/img/ll/`. |
| `type_images` | Generic photo per product (used when a product is picked without a strain). Put the image in `docs/img/products/` and add a line here. |
| `location_overrides` | Exact map pins for stores whose address can't be looked up, e.g. `"Outcrop Dispensary": [37.68, -106.35]`. |

Edit the file on github.com (pencil icon) and commit. The change applies on the next run, or immediately if you use **Actions → Refresh product locator → Run workflow**.

## Running it by hand

```bash
python3 sync/sync.py --key-file ~/Documents/product-locator/leaflink_key.txt
```

Add `--dump-raw /some/folder` to save the raw LeafLink responses for troubleshooting.

## LeafLink accounts

Each LeafLink company account needs its own key. Colorado uses the secret `LEAFLINK_API_KEY`; Oregon uses `LEAFLINK_API_KEY_OREGON`. To add another account, create a secret named `LEAFLINK_API_KEY_<NAME>` and add a matching line to `.github/workflows/sync.yml`. If one account fails, the others still update.

## Where the key lives

The LeafLink key is stored only as the GitHub secret `LEAFLINK_API_KEY` (Settings → Secrets and variables → Actions). It never goes on the website. To rotate it, create a new app in LeafLink, update the secret, then delete the old app.

## Notes

- Locations come from the LeafLink customer record (delivery address preferred). Missing coordinates are looked up once with the free US Census geocoder and cached in `data/geocache.json`.
- ZIP search on the website uses zippopotam.us; city search uses OpenStreetMap. Neither needs an account.
- Map tiles: OpenStreetMap (free, no key). Fine for normal site traffic; if traffic grows a lot, switch to a keyed tile provider such as MapTiler.


## Generated strain tiles (Panacea, Wisenheimer)

Panacea and Wisenheimer strains change every batch, so the strain picker draws an on-brand tile instead of artwork:
the brand mark (`docs/img/brands/panacea-icon.png`, `docs/img/brands/wisenheimer-hat.png`) plus the strain name, shrunk to fit.
Settings live in `GEN_ART` in `docs/locator.js`. Fonts come from the Adobe Fonts kit `lnx7cfc`
(FF DIN Paneuropean Bold for Wisenheimer; Garamond Premier Pro Bold, narrowed with CSS, standing in for ITC Garamond Condensed,
which isn't on Adobe Fonts). The kit only serves fonts on the domains listed for it at fonts.adobe.com;
other sites show fallback fonts until their domain is added there.
