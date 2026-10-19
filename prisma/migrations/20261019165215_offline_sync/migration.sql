-- CreateEnum
CREATE TYPE "QuoteOrigin" AS ENUM ('WEB', 'MOBILE');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "SyncCommandStatus" AS ENUM ('APPLIED', 'REJECTED', 'CONFLICT');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "catalogSeq" BIGINT,
ADD COLUMN     "deviceId" UUID,
ADD COLUMN     "offlineCreatedAt" TIMESTAMP(3),
ADD COLUMN     "origin" "QuoteOrigin" NOT NULL DEFAULT 'WEB';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mobileAccess" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "appVersion" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "lastPullSeq" BIGINT NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncChange" (
    "seq" BIGSERIAL NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncChange_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "SyncCommand" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SyncCommandStatus" NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,

    CONSTRAINT "SyncCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservedFolio" (
    "folio" INTEGER NOT NULL,
    "deviceId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "ReservedFolio_pkey" PRIMARY KEY ("folio")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE INDEX "SyncChange_entity_entityId_idx" ON "SyncChange"("entity", "entityId");

-- CreateIndex
CREATE INDEX "SyncCommand_deviceId_receivedAt_idx" ON "SyncCommand"("deviceId", "receivedAt");

-- CreateIndex
CREATE INDEX "SyncCommand_status_idx" ON "SyncCommand"("status");

-- CreateIndex
CREATE INDEX "ReservedFolio_deviceId_usedAt_idx" ON "ReservedFolio"("deviceId", "usedAt");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncCommand" ADD CONSTRAINT "SyncCommand_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservedFolio" ADD CONSTRAINT "ReservedFolio_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───── Bitácora de cambios para sincronización (triggers) ─────
-- TG_ARGV[0] = entidad registrada; TG_ARGV[1] = columna con el id (o '*stock' para StockBalance);
-- TG_ARGV[2] = 'child' cuando la fila es hija (registra al padre como modificado, nunca como borrado).
CREATE OR REPLACE FUNCTION sync_log() RETURNS trigger AS $$
DECLARE
  r jsonb;
  eid text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := to_jsonb(OLD); ELSE r := to_jsonb(NEW); END IF;
  IF TG_ARGV[1] = '*stock' THEN
    eid := (r->>'productId') || ':' || (r->>'warehouseId');
  ELSE
    eid := r->>TG_ARGV[1];
  END IF;
  INSERT INTO "SyncChange" ("entity", "entityId", "deleted")
  VALUES (TG_ARGV[0], eid, TG_OP = 'DELETE' AND TG_NARGS < 3);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_product AFTER INSERT OR UPDATE OR DELETE ON "Product" FOR EACH ROW EXECUTE FUNCTION sync_log('Product', 'id');
CREATE TRIGGER sync_customer AFTER INSERT OR UPDATE OR DELETE ON "Customer" FOR EACH ROW EXECUTE FUNCTION sync_log('Customer', 'id');
CREATE TRIGGER sync_customer_contact AFTER INSERT OR UPDATE OR DELETE ON "CustomerContact" FOR EACH ROW EXECUTE FUNCTION sync_log('Customer', 'customerId', 'child');
CREATE TRIGGER sync_customer_address AFTER INSERT OR UPDATE OR DELETE ON "CustomerAddress" FOR EACH ROW EXECUTE FUNCTION sync_log('Customer', 'customerId', 'child');
CREATE TRIGGER sync_quote AFTER INSERT OR UPDATE OR DELETE ON "Quote" FOR EACH ROW EXECUTE FUNCTION sync_log('Quote', 'id');
CREATE TRIGGER sync_quote_item AFTER INSERT OR UPDATE OR DELETE ON "QuoteItem" FOR EACH ROW EXECUTE FUNCTION sync_log('Quote', 'quoteId', 'child');
CREATE TRIGGER sync_sale AFTER INSERT OR UPDATE OR DELETE ON "Sale" FOR EACH ROW EXECUTE FUNCTION sync_log('Sale', 'id');
CREATE TRIGGER sync_sale_item AFTER INSERT OR UPDATE OR DELETE ON "SaleItem" FOR EACH ROW EXECUTE FUNCTION sync_log('Sale', 'saleId', 'child');
CREATE TRIGGER sync_payment AFTER INSERT OR UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION sync_log('Sale', 'saleId', 'child');
CREATE TRIGGER sync_stock AFTER INSERT OR UPDATE OR DELETE ON "StockBalance" FOR EACH ROW EXECUTE FUNCTION sync_log('StockBalance', '*stock');
CREATE TRIGGER sync_warehouse AFTER INSERT OR UPDATE OR DELETE ON "Warehouse" FOR EACH ROW EXECUTE FUNCTION sync_log('Warehouse', 'id');
CREATE TRIGGER sync_exchange_rate AFTER INSERT OR UPDATE OR DELETE ON "ExchangeRate" FOR EACH ROW EXECUTE FUNCTION sync_log('ExchangeRate', 'id');
CREATE TRIGGER sync_complement AFTER INSERT OR UPDATE OR DELETE ON "ComplementPackage" FOR EACH ROW EXECUTE FUNCTION sync_log('ComplementPackage', 'id');
