-- Prisma 7 upgrade: Convert implicit m-n relation table unique indexes to primary keys

-- Ensure join tables exist in the shadow DB (older migrations missed them)
CREATE TABLE IF NOT EXISTS "_OrgManagers" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "_UserCauses" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_OrgManagers_A_fkey') THEN
    ALTER TABLE "_OrgManagers" ADD CONSTRAINT "_OrgManagers_A_fkey" FOREIGN KEY ("A") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_OrgManagers_B_fkey') THEN
    ALTER TABLE "_OrgManagers" ADD CONSTRAINT "_OrgManagers_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_OrgManagers_AB_pkey') THEN
    ALTER TABLE "_OrgManagers" ADD CONSTRAINT "_OrgManagers_AB_pkey" PRIMARY KEY ("A", "B");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_UserCauses_A_fkey') THEN
    ALTER TABLE "_UserCauses" ADD CONSTRAINT "_UserCauses_A_fkey" FOREIGN KEY ("A") REFERENCES "Cause"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_UserCauses_B_fkey') THEN
    ALTER TABLE "_UserCauses" ADD CONSTRAINT "_UserCauses_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_UserCauses_AB_pkey') THEN
    ALTER TABLE "_UserCauses" ADD CONSTRAINT "_UserCauses_AB_pkey" PRIMARY KEY ("A", "B");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "_OrgManagers_B_index" ON "_OrgManagers"("B");
CREATE INDEX IF NOT EXISTS "_UserCauses_B_index" ON "_UserCauses"("B");

-- DropIndex
DROP INDEX IF EXISTS "_OrgManagers_AB_unique";
DROP INDEX IF EXISTS "_UserCauses_AB_unique";
