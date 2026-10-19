-- v1.3.19: autorización de descuentos en cotizaciones
CREATE TYPE "DiscountApproval" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Quote"
  ADD COLUMN "discountStatus" "DiscountApproval" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "discountNote" TEXT,
  ADD COLUMN "discountDecidedById" UUID,
  ADD COLUMN "discountDecidedAt" TIMESTAMP(3);

ALTER TABLE "Quote" ADD CONSTRAINT "Quote_discountDecidedById_fkey"
  FOREIGN KEY ("discountDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Las cotizaciones existentes con descuento ya se respetaron: quedan como autorizadas.
UPDATE "Quote" SET "discountStatus" = 'APPROVED' WHERE "discountTotal" > 0;
