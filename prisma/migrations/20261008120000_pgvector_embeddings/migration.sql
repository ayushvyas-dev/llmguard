CREATE EXTENSION IF NOT EXISTS vector;

DO $$ BEGIN
  CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'EMBEDDING_QUEUED', 'READY', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "VerificationStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The initial migrations in this repository predate these models. Create the
-- verification tables here as well so a fresh `migrate deploy` is usable.
ALTER TABLE "scans" ADD COLUMN IF NOT EXISTS "apiKeyId" UUID;
ALTER TABLE "scans" ADD COLUMN IF NOT EXISTS "type" VARCHAR(20) NOT NULL DEFAULT 'prompt';
ALTER TABLE "scans" ADD COLUMN IF NOT EXISTS "decision" VARCHAR(20);
CREATE INDEX IF NOT EXISTS "scans_apiKeyId_idx" ON "scans"("apiKeyId");
DO $$ BEGIN
  ALTER TABLE "scans" ADD CONSTRAINT "scans_apiKeyId_fkey"
    FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "detections" (
  "id" UUID PRIMARY KEY,
  "scanId" UUID NOT NULL REFERENCES "scans"("id") ON DELETE CASCADE,
  "type" VARCHAR(50) NOT NULL,
  "subtype" VARCHAR(50),
  "confidence" DOUBLE PRECISION NOT NULL,
  "reason" TEXT,
  "start" INTEGER,
  "end" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "detections_scanId_idx" ON "detections"("scanId");
CREATE INDEX IF NOT EXISTS "detections_type_idx" ON "detections"("type");

CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" UUID PRIMARY KEY,
  "apiKeyId" UUID NOT NULL REFERENCES "api_keys"("id"),
  "requestId" TEXT NOT NULL,
  "scanId" UUID,
  "type" VARCHAR(50) NOT NULL,
  "severity" VARCHAR(20) NOT NULL,
  "decision" VARCHAR(20) NOT NULL,
  "riskScore" DOUBLE PRECISION,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "audit_events_apiKeyId_idx" ON "audit_events"("apiKeyId");
CREATE INDEX IF NOT EXISTS "audit_events_createdAt_idx" ON "audit_events"("createdAt");
CREATE INDEX IF NOT EXISTS "audit_events_severity_idx" ON "audit_events"("severity");
CREATE INDEX IF NOT EXISTS "audit_events_decision_idx" ON "audit_events"("decision");
CREATE INDEX IF NOT EXISTS "audit_events_type_idx" ON "audit_events"("type");

CREATE TABLE IF NOT EXISTS "tool_policies" (
  "id" UUID PRIMARY KEY,
  "apiKeyId" UUID NOT NULL REFERENCES "api_keys"("id"),
  "name" VARCHAR(255) NOT NULL,
  "riskLevel" VARCHAR(20) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "tool_policies_apiKeyId_name_key" ON "tool_policies"("apiKeyId", "name");
CREATE INDEX IF NOT EXISTS "tool_policies_apiKeyId_idx" ON "tool_policies"("apiKeyId");

CREATE TABLE IF NOT EXISTS "documents" (
  "id" UUID PRIMARY KEY,
  "apiKeyId" UUID NOT NULL REFERENCES "api_keys"("id"),
  "content" TEXT NOT NULL,
  "metadata" JSONB,
  "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "documents_apiKeyId_idx" ON "documents"("apiKeyId");
CREATE INDEX IF NOT EXISTS "documents_status_idx" ON "documents"("status");

CREATE TABLE IF NOT EXISTS "verification_jobs" (
  "id" UUID PRIMARY KEY,
  "apiKeyId" UUID NOT NULL REFERENCES "api_keys"("id"),
  "answer" TEXT NOT NULL,
  "context" TEXT,
  "status" "VerificationStatus" NOT NULL DEFAULT 'QUEUED',
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "verification_jobs_apiKeyId_idx" ON "verification_jobs"("apiKeyId");
CREATE INDEX IF NOT EXISTS "verification_jobs_status_idx" ON "verification_jobs"("status");

CREATE TABLE IF NOT EXISTS "claims" (
  "id" UUID PRIMARY KEY,
  "verificationJobId" UUID NOT NULL REFERENCES "verification_jobs"("id") ON DELETE CASCADE,
  "claim" TEXT NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "confidence" DOUBLE PRECISION,
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "claims_verificationJobId_idx" ON "claims"("verificationJobId");

CREATE TABLE IF NOT EXISTS "embeddings" (
  "id" UUID PRIMARY KEY,
  "documentId" UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "chunkIndex" INTEGER NOT NULL,
  "chunkText" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "embeddings_documentId_idx" ON "embeddings"("documentId");

-- Prisma 7 does not model pgvector's vector type. Keep the physical column in SQL.
ALTER TABLE "embeddings"
  ADD COLUMN IF NOT EXISTS "embedding" vector(768);

CREATE INDEX IF NOT EXISTS "embeddings_embedding_cosine_hnsw_idx"
  ON "embeddings"
  USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embedding" IS NOT NULL;
