import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReservationsTable1788309117211
  implements MigrationInterface
{
  name = 'CreateReservationsTable1788309117211';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "reservations_status_enum" AS ENUM ('confirmed', 'cancelled')`,
    );

    await queryRunner.query(`
      CREATE TABLE "reservations" (
        "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
        "user_id"     uuid NOT NULL REFERENCES "users"("id")     ON DELETE CASCADE,
        "starts_at"   timestamptz NOT NULL,
        "ends_at"     timestamptz NOT NULL,
        "status"      "reservations_status_enum" NOT NULL DEFAULT 'confirmed',
        "created_at"  timestamptz NOT NULL DEFAULT now(),
        "updated_at"  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_reservations_range" CHECK ("ends_at" > "starts_at"),
        CONSTRAINT "EXC_reservations_no_overlap" EXCLUDE USING gist (
          "resource_id" WITH =,
          tstzrange("starts_at", "ends_at", '[)') WITH &&
        ) WHERE ("status" <> 'cancelled')
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_reservations_user_id" ON "reservations" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reservations_resource_starts_at" ON "reservations" ("resource_id", "starts_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_reservations_resource_starts_at"`);
    await queryRunner.query(`DROP INDEX "IDX_reservations_user_id"`);
    await queryRunner.query(`DROP TABLE "reservations"`);
    await queryRunner.query(`DROP TYPE "reservations_status_enum"`);
  }
}
