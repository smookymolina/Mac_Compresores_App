-- Invitación por correo y código de acceso por correo (sustituye a la app autenticadora para socios nuevos).
ALTER TABLE "Partner" ADD COLUMN "inviteTokenHash" TEXT, ADD COLUMN "inviteExpiresAt" TIMESTAMP(3), ADD COLUMN "passwordSetAt" TIMESTAMP(3),
  ADD COLUMN "emailCodeHash" TEXT, ADD COLUMN "emailCodeExpiresAt" TIMESTAMP(3), ADD COLUMN "emailCodeTries" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "Partner_inviteTokenHash_key" ON "Partner"("inviteTokenHash");
-- Los socios existentes ya tenían contraseña.
UPDATE "Partner" SET "passwordSetAt" = "createdAt";
ALTER TYPE "PartnerActivityType" ADD VALUE 'INVITE_SENT';
ALTER TYPE "PartnerActivityType" ADD VALUE 'PASSWORD_SET';
ALTER TYPE "PartnerActivityType" ADD VALUE 'EMAIL_CODE_SENT';
ALTER TYPE "PartnerActivityType" ADD VALUE 'EMAIL_CODE_OK';
ALTER TYPE "PartnerActivityType" ADD VALUE 'EMAIL_CODE_FAIL';
