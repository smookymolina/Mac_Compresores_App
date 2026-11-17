-- v1.3.21: motivo de pérdida en cotizaciones (obligatorio al pasar a REJECTED o CANCELLED; lo valida el servicio).
-- Las cotizaciones rechazadas/canceladas anteriores quedan sin motivo (histórico, no se inventa).
CREATE TYPE "QuoteLostReason" AS ENUM ('PRICE', 'COMPETITOR', 'NO_BUDGET', 'NO_RESPONSE', 'TIMING', 'REQUIREMENTS', 'DUPLICATE', 'ABANDONED', 'OTHER');

ALTER TABLE "Quote"
  ADD COLUMN "lostReason" "QuoteLostReason",
  ADD COLUMN "lostNote" TEXT,
  ADD COLUMN "lostReviewedById" UUID,
  ADD COLUMN "lostReviewedAt" TIMESTAMP(3);

ALTER TABLE "Quote" ADD CONSTRAINT "Quote_lostReviewedById_fkey"
  FOREIGN KEY ("lostReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
