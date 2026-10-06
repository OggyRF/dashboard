BEGIN;

-- AlterTable
ALTER TABLE "daily_task_ticks" ADD COLUMN     "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "done_at" DROP NOT NULL;

-- AlterTable
ALTER TABLE "daily_tasks" ADD COLUMN     "auto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "follow_up_id" TEXT;

-- CreateTable
CREATE TABLE "daily_plan_runs" (
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_plan_runs_pkey" PRIMARY KEY ("user_id","date")
);

-- CreateIndex
CREATE INDEX "daily_tasks_follow_up_id_date_idx" ON "daily_tasks"("follow_up_id", "date");

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_follow_up_id_fkey" FOREIGN KEY ("follow_up_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_plan_runs" ADD CONSTRAINT "daily_plan_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Units ticked before this change were started when they were finished.
UPDATE "daily_task_ticks" SET "started_at" = "done_at" WHERE "done_at" IS NOT NULL;

-- Existing daily lines are followed up by the client's SEO Project Manager.
UPDATE "daily_tasks" d SET "follow_up_id" = c."execution_owner_id"
FROM "clients" c WHERE c."id" = d."client_id" AND d."follow_up_id" IS NULL;

COMMIT;
