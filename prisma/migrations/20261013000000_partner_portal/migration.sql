-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PartnerActivityType" AS ENUM ('LOGIN_OK', 'LOGIN_FAIL', 'TOTP_OK', 'TOTP_FAIL', 'TOTP_SETUP', 'BACKUP_CODE_USED', 'SEARCH', 'PRICE_VIEW', 'LOGOUT', 'SESSION_REVOKED', 'QUOTA_EXCEEDED', 'RATE_LIMITED', 'AUTO_BLOCK', 'SWEEP_SUSPECT', 'HIDDEN', 'PRINT_ATTEMPT', 'COPY_ATTEMPT', 'CAPTURE_KEY', 'DEVTOOLS', 'WEBDRIVER', 'HONEYPOT', 'ADMIN_CHANGE');

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "totpSecretEnc" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "totpLastStep" INTEGER,
    "backupCodes" TEXT[],
    "discountPct" DECIMAL(5,2),
    "dailyQuota" INTEGER,
    "status" "PartnerStatus" NOT NULL DEFAULT 'ACTIVE',
    "blockedReason" TEXT,
    "blockedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerSession" (
    "id" TEXT NOT NULL,
    "partnerId" UUID NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerActivity" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "type" "PartnerActivityType" NOT NULL,
    "meta" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_email_key" ON "Partner"("email");

-- CreateIndex
CREATE INDEX "PartnerSession_partnerId_idx" ON "PartnerSession"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerActivity_partnerId_createdAt_idx" ON "PartnerActivity"("partnerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PartnerActivity_type_createdAt_idx" ON "PartnerActivity"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSession" ADD CONSTRAINT "PartnerSession_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerActivity" ADD CONSTRAINT "PartnerActivity_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

