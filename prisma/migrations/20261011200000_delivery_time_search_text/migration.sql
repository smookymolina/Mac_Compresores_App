-- Tiempo de entrega por cotización
ALTER TABLE "Quote" ADD COLUMN "deliveryTime" TEXT;

-- Búsqueda de productos sin acentos ni mayúsculas
CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE "Product" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';

CREATE FUNCTION product_search_text() RETURNS trigger AS $$
BEGIN
  NEW."searchText" := lower(unaccent(concat_ws(' ', NEW."sku", NEW."description", NEW."oemName", NEW."oemPartNumber", NEW."supplierCode")));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_search_text
  BEFORE INSERT OR UPDATE ON "Product"
  FOR EACH ROW EXECUTE FUNCTION product_search_text();

UPDATE "Product" SET "searchText" = lower(unaccent(concat_ws(' ', "sku", "description", "oemName", "oemPartNumber", "supplierCode")));
