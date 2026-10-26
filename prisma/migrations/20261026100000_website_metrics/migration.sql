-- CreateTable
CREATE TABLE "website_metrics" (
    "client_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "da" INTEGER,
    "pa" INTEGER,
    "spam_score" INTEGER,
    "backlinks" INTEGER,
    "ref_domains" INTEGER,
    "mobile_speed" INTEGER,
    "desktop_speed" INTEGER,
    "checked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_metrics_pkey" PRIMARY KEY ("client_id","month")
);

-- AddForeignKey
ALTER TABLE "website_metrics" ADD CONSTRAINT "website_metrics_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
