-- CreateTable
CREATE TABLE "AdminLoginRateLimit" (
    "key" VARCHAR(80) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminLoginRateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "AdminLoginRateLimit_expiresAt_idx" ON "AdminLoginRateLimit"("expiresAt");
