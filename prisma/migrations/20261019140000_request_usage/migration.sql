-- AlterTable
ALTER TABLE "McpToolCall" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'mcp',
ADD COLUMN     "costUsd" DOUBLE PRECISION,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "llmCalls" INTEGER,
ADD COLUMN     "outputTokens" INTEGER;

