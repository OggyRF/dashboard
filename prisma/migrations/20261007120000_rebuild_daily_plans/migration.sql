-- The first automatic daily plans put a whole week's off-page work on one day.
-- Remove the pieces nobody has started so every list is made again, evenly,
-- the next time it is opened. Pieces already started or completed stay.
BEGIN;

DELETE FROM "daily_tasks" d
WHERE d."auto" AND NOT EXISTS (SELECT 1 FROM "daily_task_ticks" t WHERE t."daily_task_id" = d."id");

-- Number the started pieces 1, 2, 3... (via negatives to avoid clashes) and
-- shrink each line to them.
UPDATE "daily_task_ticks" t SET "n" = -t."n"
FROM "daily_tasks" d WHERE d."id" = t."daily_task_id" AND d."auto";
UPDATE "daily_task_ticks" t SET "n" = r.rn
FROM (
  SELECT t2."id", row_number() OVER (PARTITION BY t2."daily_task_id" ORDER BY -t2."n") AS rn
  FROM "daily_task_ticks" t2 JOIN "daily_tasks" d2 ON d2."id" = t2."daily_task_id"
  WHERE d2."auto"
) r
WHERE r."id" = t."id";
UPDATE "daily_tasks" d SET "qty" = c.cnt
FROM (SELECT "daily_task_id", count(*)::int AS cnt FROM "daily_task_ticks" GROUP BY "daily_task_id") c
WHERE c."daily_task_id" = d."id" AND d."auto" AND d."qty" <> c.cnt;

DELETE FROM "daily_plan_runs";

-- Clients were added in the last days of October's week 1, so its open boxes
-- move to weeks 2 to 4 (work starts from when a client was added).
UPDATE "offpage_items" i SET "week" = 2 + ((r.rn - 1) % 3)
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "activity_id" ORDER BY "created_at", "id") AS rn
  FROM "offpage_items"
  WHERE "month" = '2026-10' AND "week" = 1 AND "done_at" IS NULL AND "created_at" >= '2026-10-05'
) r
WHERE r."id" = i."id";

COMMIT;
