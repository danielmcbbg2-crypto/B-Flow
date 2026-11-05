-- Listing details for quality, Australian compliance and search: the specs as a table (instead of
-- bullets in the description), key selling points, the title and description search results and
-- link previews show, a description of each photo, the barcode, and the product's compliance
-- details (WELS water rating, WaterMark certification, standards met, warranty).
--
-- compliance is { welsStars, welsWater, welsReg, watermark, standards: [], warranty }, each optional:
--   welsStars  number, e.g. 5        welsWater  "6.0 L/min" or "4.5/3 L full/half flush"
--   welsReg    the WELS registration number, e.g. "T31433"
--   watermark  the WaterMark licence, e.g. "WMK 25123" or "AS/NZS 3718 WM74514"
--   standards  e.g. ["AS/NZS 2208 Grade A safety glass"]
--   warranty   the manufacturer's warranty in plain words, e.g. "5 years on the cartridge"
alter table public.products
  add column specs jsonb not null default '[]' check (jsonb_typeof(specs) = 'array'),
  add column highlights text[] not null default '{}',
  add column seo_title text not null default '',
  add column meta_description text not null default '',
  add column image_alt text[] not null default '{}',
  add column gtin text not null default '' check (gtin = '' or gtin ~ '^\d{8,14}$'),
  add column compliance jsonb not null default '{}' check (jsonb_typeof(compliance) = 'object');

comment on column public.products.specs is 'Specifications as [{ "label": "Width", "value": "750 mm" }], in display order.';
comment on column public.products.highlights is 'Up to 6 short selling points (shown on the product page and sent to Google as product highlights).';
comment on column public.products.seo_title is 'Title for search results and link previews (up to 60 characters); the title is used when empty.';
comment on column public.products.meta_description is 'Description for search results and link previews (up to 160 characters); made from the description when empty.';
comment on column public.products.image_alt is 'A description of each photo, in the same order as images, for screen readers and image search.';
comment on column public.products.gtin is 'The barcode (GTIN/EAN/UPC, 8 to 14 digits), if the maker gives one.';
comment on column public.products.compliance is 'WELS, WaterMark, standards and warranty details (see the migration for the fields).';
