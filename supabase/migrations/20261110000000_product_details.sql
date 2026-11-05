-- Product details for listings, as the store's product feed (google-shopping-feed) sends them to
-- Google Merchant Center and Meta Commerce Manager:
--   specs       [{ "label": "Width", "value": "900 mm" }, …]   up to 40
--   highlights  short selling points                             up to 10
--   gtin        the barcode (8 to 14 digits), or ''
--   compliance  { "welsStars": 4, "welsWater": "6 L/min", "welsReg": "…", "watermark": "WMK 12345",
--                 "standards": ["AS/NZS 3718"], "warranty": "15 years" }
-- Public details like the rest of the listing: visitors see them on published products, and only
-- store managers can change them (the products table's existing rules).

alter table public.products
  add column if not exists specs jsonb not null default '[]'::jsonb,
  add column if not exists highlights text[] not null default '{}',
  add column if not exists gtin text not null default '',
  add column if not exists compliance jsonb not null default '{}'::jsonb;

alter table public.products
  add constraint products_specs_shape check (
    jsonb_typeof(specs) = 'array' and jsonb_array_length(specs) <= 40
    and not jsonb_path_exists(specs, '$[*] ? (@.type() != "object" || !exists(@.label) || !exists(@.value) || @.label.type() != "string" || @.value.type() != "string")')
  ),
  add constraint products_highlights_size check (cardinality(highlights) <= 10),
  add constraint products_gtin_digits check (gtin = '' or gtin ~ '^[0-9]{8,14}$'),
  add constraint products_compliance_shape check (
    jsonb_typeof(compliance) = 'object'
    and (not compliance ? 'welsStars' or (jsonb_typeof(compliance -> 'welsStars') = 'number' and (compliance ->> 'welsStars')::numeric between 0 and 6))
    and (not compliance ? 'standards' or jsonb_typeof(compliance -> 'standards') = 'array')
    and not jsonb_path_exists(compliance, '$ ? (exists(@.welsWater) && @.welsWater.type() != "string" || exists(@.welsReg) && @.welsReg.type() != "string" || exists(@.watermark) && @.watermark.type() != "string" || exists(@.warranty) && @.warranty.type() != "string")')
  );
