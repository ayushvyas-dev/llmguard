/*
  Warnings:

  - The primary key for the `api_keys` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `name` on the `api_keys` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(255)`.
  - The primary key for the `scans` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Changed the type of `id` on the `api_keys` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `scans` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ALTER COLUMN "name" SET DATA TYPE VARCHAR(255),
ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "scans" DROP CONSTRAINT "scans_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "scans_pkey" PRIMARY KEY ("id");
