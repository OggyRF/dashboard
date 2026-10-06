-- All or nothing: a failure part-way leaves the database as it was.
BEGIN;

-- CreateEnum
CREATE TYPE "DailyWork" AS ENUM ('WRITING', 'UPLOADING', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskCategory" ADD VALUE 'RESEARCH';
ALTER TYPE "TaskCategory" ADD VALUE 'PLANNING';
ALTER TYPE "TaskCategory" ADD VALUE 'STRATEGY';

-- Tasks now go Not started -> Under process -> Completed. Fold the old QA and
-- blocked steps into those before the old values are dropped.
UPDATE "tasks" SET "status" = 'COMPLETED' WHERE "status" = 'APPROVED';
UPDATE "tasks" SET "status" = 'IN_PROGRESS' WHERE "status" IN ('SUBMITTED', 'QA');
UPDATE "tasks" SET "status" = COALESCE("status_before_blocked", 'IN_PROGRESS') WHERE "status" = 'BLOCKED';
UPDATE "tasks" SET "status" = 'IN_PROGRESS' WHERE "status" NOT IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');
ALTER TABLE "tasks" DROP COLUMN "status_before_blocked";

-- AlterEnum
CREATE TYPE "TaskStatus_new" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');
ALTER TABLE "public"."tasks" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "tasks" ALTER COLUMN "status" TYPE "TaskStatus_new" USING ("status"::text::"TaskStatus_new");
ALTER TYPE "TaskStatus" RENAME TO "TaskStatus_old";
ALTER TYPE "TaskStatus_new" RENAME TO "TaskStatus";
DROP TYPE "public"."TaskStatus_old";
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'NOT_STARTED';

-- The QA reviewer becomes the follow-up person; keep whoever was set.
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_reviewer_id_fkey";
DROP INDEX "tasks_reviewer_id_status_idx";
ALTER TABLE "tasks" RENAME COLUMN "reviewer_id" TO "follow_up_id";

-- AlterTable
ALTER TABLE "attendance_days" ADD COLUMN     "work_note" TEXT,
ADD COLUMN     "work_note_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "reply_to_id" TEXT;

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "offpage_owner_id" TEXT;

-- AlterTable
ALTER TABLE "offpage_activities" ADD COLUMN     "only_month" TEXT;

-- AlterTable
ALTER TABLE "tasks" DROP COLUMN "blocked_reason",
DROP COLUMN "rejection_reason",
DROP COLUMN "submission_note",
DROP COLUMN "submitted_at",
ADD COLUMN     "overdue_notified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "offpage_month_qtys" (
    "activity_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offpage_month_qtys_pkey" PRIMARY KEY ("activity_id","month")
);

-- CreateTable
CREATE TABLE "chat_attachments" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_tasks" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "assignee_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "activity_id" TEXT,
    "work" "DailyWork" NOT NULL,
    "details" TEXT,
    "qty" INTEGER NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_task_ticks" (
    "id" TEXT NOT NULL,
    "daily_task_id" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "done_at" TIMESTAMP(3) NOT NULL,
    "done_by_id" TEXT,
    "proof_url" TEXT,
    "offpage_item_id" TEXT,

    CONSTRAINT "daily_task_ticks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offpage_month_qtys_client_id_month_idx" ON "offpage_month_qtys"("client_id", "month");

-- CreateIndex
CREATE INDEX "chat_attachments_message_id_idx" ON "chat_attachments"("message_id");

-- CreateIndex
CREATE INDEX "daily_tasks_assignee_id_date_idx" ON "daily_tasks"("assignee_id", "date");

-- CreateIndex
CREATE INDEX "daily_tasks_date_idx" ON "daily_tasks"("date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_task_ticks_offpage_item_id_key" ON "daily_task_ticks"("offpage_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_task_ticks_daily_task_id_n_key" ON "daily_task_ticks"("daily_task_id", "n");

-- CreateIndex
CREATE INDEX "tasks_follow_up_id_status_idx" ON "tasks"("follow_up_id", "status");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_offpage_owner_id_fkey" FOREIGN KEY ("offpage_owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_follow_up_id_fkey" FOREIGN KEY ("follow_up_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offpage_month_qtys" ADD CONSTRAINT "offpage_month_qtys_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "offpage_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offpage_month_qtys" ADD CONSTRAINT "offpage_month_qtys_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "offpage_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_task_ticks" ADD CONSTRAINT "daily_task_ticks_daily_task_id_fkey" FOREIGN KEY ("daily_task_id") REFERENCES "daily_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_task_ticks" ADD CONSTRAINT "daily_task_ticks_done_by_id_fkey" FOREIGN KEY ("done_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_task_ticks" ADD CONSTRAINT "daily_task_ticks_offpage_item_id_fkey" FOREIGN KEY ("offpage_item_id") REFERENCES "offpage_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
