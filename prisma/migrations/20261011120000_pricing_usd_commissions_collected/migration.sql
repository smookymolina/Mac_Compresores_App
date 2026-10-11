-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('MXN', 'USD');

-- DropIndex
DROP INDEX "CommissionEntry_periodId_sellerId_line_key";

-- AlterTable
ALTER TABLE "CommissionEntry" ADD COLUMN     "collectedAt" DATE,
ADD COLUMN     "saleId" UUID;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "consumables" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "currency" "Currency" NOT NULL DEFAULT 'MXN';

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "exchangeRate" DECIMAL(10,4);

-- AlterTable
ALTER TABLE "QuoteItem" ADD COLUMN     "details" TEXT,
ADD COLUMN     "fxRate" DECIMAL(10,4) NOT NULL DEFAULT 1,
ADD COLUMN     "origCurrency" "Currency" NOT NULL DEFAULT 'MXN',
ADD COLUMN     "origUnitPrice" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "expenses" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "details" TEXT,
ADD COLUMN     "fxRate" DECIMAL(10,4) NOT NULL DEFAULT 1,
ADD COLUMN     "origCurrency" "Currency" NOT NULL DEFAULT 'MXN',
ADD COLUMN     "origUnitPrice" DECIMAL(14,4);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" UUID NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExchangeRate_createdAt_idx" ON "ExchangeRate"("createdAt");

-- CreateIndex
CREATE INDEX "CommissionEntry_saleId_idx" ON "CommissionEntry"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionEntry_periodId_saleId_line_key" ON "CommissionEntry"("periodId", "saleId", "line");

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Datos: la tubería se maneja en USD; las comisiones previas (agregadas por línea) se descartan solo si no están aprobadas/pagadas.
UPDATE "Product" SET "currency" = 'USD' WHERE "line" = 'TUBERIA';
DELETE FROM "CommissionEntry" WHERE "saleId" IS NULL AND "status" = 'CALCULATED';
UPDATE "CommissionRuleSet" SET "basis" = 'MARGIN' WHERE "status" = 'DRAFT';
