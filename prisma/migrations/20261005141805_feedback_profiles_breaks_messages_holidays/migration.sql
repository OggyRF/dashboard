-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'DELETED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_updated_at" TIMESTAMP(3),
ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "user_avatars" (
    "user_id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "content_type" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_avatars_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "message_participants" (
    "thread_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "message_participants_pkey" PRIMARY KEY ("thread_id","user_id")
);

-- CreateIndex
CREATE INDEX "message_participants_user_id_idx" ON "message_participants"("user_id");

-- AddForeignKey
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_participants" ADD CONSTRAINT "message_participants_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_participants" ADD CONSTRAINT "message_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing conversations were between their starter and both owners.
INSERT INTO "message_participants" ("thread_id", "user_id")
SELECT t."id", t."from_user_id" FROM "message_threads" t
ON CONFLICT DO NOTHING;
INSERT INTO "message_participants" ("thread_id", "user_id")
SELECT t."id", u."id" FROM "message_threads" t CROSS JOIN "users" u
WHERE u."role" = 'OWNER' AND u."status" = 'ACTIVE'
ON CONFLICT DO NOTHING;

-- Major Indian holidays: the rest of 2026 and all of 2027, from the central
-- government gazetted lists (DoP&T), plus Ambedkar Jayanti. Owners can edit
-- or remove any of them on Settings > Holidays; existing dates are kept.
INSERT INTO "holidays" ("id", "date", "name") VALUES
  ('hol-2026-10-20', DATE '2026-10-20', 'Dussehra'),
  ('hol-2026-11-08', DATE '2026-11-08', 'Diwali'),
  ('hol-2026-11-24', DATE '2026-11-24', 'Guru Nanak Jayanti'),
  ('hol-2026-12-25', DATE '2026-12-25', 'Christmas'),
  ('hol-2027-01-26', DATE '2027-01-26', 'Republic Day'),
  ('hol-2027-03-10', DATE '2027-03-10', 'Eid-ul-Fitr'),
  ('hol-2027-03-23', DATE '2027-03-23', 'Holi'),
  ('hol-2027-03-26', DATE '2027-03-26', 'Good Friday'),
  ('hol-2027-04-14', DATE '2027-04-14', 'Ambedkar Jayanti'),
  ('hol-2027-04-15', DATE '2027-04-15', 'Ram Navami'),
  ('hol-2027-04-19', DATE '2027-04-19', 'Mahavir Jayanti'),
  ('hol-2027-05-17', DATE '2027-05-17', 'Bakrid (Eid-ul-Zuha)'),
  ('hol-2027-05-20', DATE '2027-05-20', 'Buddha Purnima'),
  ('hol-2027-06-16', DATE '2027-06-16', 'Muharram'),
  ('hol-2027-08-15', DATE '2027-08-15', 'Independence Day / Milad-un-Nabi'),
  ('hol-2027-08-25', DATE '2027-08-25', 'Janmashtami'),
  ('hol-2027-10-02', DATE '2027-10-02', 'Gandhi Jayanti'),
  ('hol-2027-10-09', DATE '2027-10-09', 'Dussehra'),
  ('hol-2027-10-29', DATE '2027-10-29', 'Diwali'),
  ('hol-2027-11-14', DATE '2027-11-14', 'Guru Nanak Jayanti'),
  ('hol-2027-12-25', DATE '2027-12-25', 'Christmas')
ON CONFLICT ("date") DO NOTHING;
