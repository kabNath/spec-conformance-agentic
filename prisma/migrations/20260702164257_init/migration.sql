-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" TEXT,
    "version" TEXT,
    "release" TEXT,
    "cloudinaryUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConformanceRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetRelease" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "reviewThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "summary" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ConformanceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluatedRequirement" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "source" JSONB NOT NULL,
    "citations" JSONB NOT NULL,
    "verdict" TEXT NOT NULL,
    "normative" TEXT NOT NULL DEFAULT 'none',
    "confidence" DOUBLE PRECISION NOT NULL,
    "verifier" JSONB NOT NULL,
    "review" JSONB NOT NULL,
    "gapNote" TEXT,
    "retrievalPath" JSONB,
    "attestation" JSONB,
    "model" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluatedRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Asset_orgId_idx" ON "Asset"("orgId");

-- CreateIndex
CREATE INDEX "ConformanceRun_orgId_idx" ON "ConformanceRun"("orgId");

-- CreateIndex
CREATE INDEX "EvaluatedRequirement_runId_idx" ON "EvaluatedRequirement"("runId");

-- CreateIndex
CREATE INDEX "EvaluatedRequirement_orgId_idx" ON "EvaluatedRequirement"("orgId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConformanceRun" ADD CONSTRAINT "ConformanceRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluatedRequirement" ADD CONSTRAINT "EvaluatedRequirement_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ConformanceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
