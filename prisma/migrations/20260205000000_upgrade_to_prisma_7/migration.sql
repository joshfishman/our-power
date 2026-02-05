-- Prisma 7 upgrade: Convert implicit m-n relation table unique indexes to primary keys

-- AlterTable
ALTER TABLE "_OrgManagers" ADD CONSTRAINT "_OrgManagers_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_OrgManagers_AB_unique";

-- AlterTable
ALTER TABLE "_UserCauses" ADD CONSTRAINT "_UserCauses_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_UserCauses_AB_unique";
