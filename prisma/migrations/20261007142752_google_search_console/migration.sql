-- CreateEnum
CREATE TYPE "DataSourceKind" AS ENUM ('GSC');

-- CreateEnum
CREATE TYPE "GscDimension" AS ENUM ('QUERY', 'PAGE', 'QUERY_PAGE', 'DEVICE', 'COUNTRY');

-- CreateTable
CREATE TABLE "google_connections" (
    "id" TEXT NOT NULL DEFAULT 'agency',
    "email" TEXT NOT NULL,
    "refresh_token_enc" TEXT NOT NULL,
    "connected_by_id" TEXT,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "broken_at" TIMESTAMP(3),
    "last_error" TEXT,

    CONSTRAINT "google_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_data_sources" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "kind" "DataSourceKind" NOT NULL,
    "external_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recent_synced_on" DATE,
    "backfill_month" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,

    CONSTRAINT "client_data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gsc_daily_totals" (
    "data_source_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "gsc_daily_totals_pkey" PRIMARY KEY ("data_source_id","date")
);

-- CreateTable
CREATE TABLE "gsc_rows" (
    "id" BIGSERIAL NOT NULL,
    "data_source_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "dimension" "GscDimension" NOT NULL,
    "key1" TEXT NOT NULL,
    "key2" TEXT NOT NULL DEFAULT '',
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "gsc_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_leases" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_leases_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_data_sources_client_id_kind_key" ON "client_data_sources"("client_id", "kind");

-- CreateIndex
CREATE INDEX "gsc_rows_data_source_id_month_dimension_clicks_idx" ON "gsc_rows"("data_source_id", "month", "dimension", "clicks" DESC);

-- AddForeignKey
ALTER TABLE "client_data_sources" ADD CONSTRAINT "client_data_sources_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gsc_daily_totals" ADD CONSTRAINT "gsc_daily_totals_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "client_data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gsc_rows" ADD CONSTRAINT "gsc_rows_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "client_data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
