-- AlterTable
ALTER TABLE "EvaluatedRequirement" ADD COLUMN     "trace" JSONB;

-- CreateTable
CREATE TABLE "RejectedQuote" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "length" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RejectedQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RejectedQuote_requirementId_key" ON "RejectedQuote"("requirementId");

-- CreateIndex
CREATE INDEX "RejectedQuote_orgId_idx" ON "RejectedQuote"("orgId");

-- AddForeignKey
ALTER TABLE "RejectedQuote" ADD CONSTRAINT "RejectedQuote_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "EvaluatedRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
