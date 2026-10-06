-- AlterTable
ALTER TABLE "attendance_days" ADD COLUMN     "last_seen_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "attendance_events" ADD COLUMN     "note" TEXT;
