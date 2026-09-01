import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateResourcesTables1788256817633 implements MigrationInterface {
  name = 'CreateResourcesTables1788256817633';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres ships no built-in `timerange`; `CREATE TYPE ... AS RANGE`
    // auto-creates the constructor and inherits generic GiST `range_ops`,
    // which the EXCLUDE constraint below needs to compare open/close windows.
    await queryRunner.query(
      `CREATE TYPE "timerange" AS RANGE (subtype = time)`,
    );

    await queryRunner.query(`
      CREATE TABLE "resources" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(120) NOT NULL,
        "capacity" integer NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "min_booking_minutes" integer NOT NULL,
        "max_booking_minutes" integer NOT NULL,
        "notes" text,
        "amenities" text[] NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_resources_capacity" CHECK ("capacity" >= 1),
        CONSTRAINT "CHK_resources_booking_minutes" CHECK (
          "min_booking_minutes" >= 30
          AND "min_booking_minutes" % 30 = 0
          AND "max_booking_minutes" % 30 = 0
          AND "max_booking_minutes" >= "min_booking_minutes"
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "resource_schedules" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
        "day_of_week" smallint NOT NULL,
        "open_time" time NOT NULL,
        "close_time" time NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_resource_schedules_dow" CHECK ("day_of_week" BETWEEN 0 AND 6),
        CONSTRAINT "CHK_resource_schedules_window" CHECK ("close_time" > "open_time"),
        CONSTRAINT "EXC_resource_schedules_no_overlap" EXCLUDE USING gist (
          "resource_id" WITH =,
          "day_of_week" WITH =,
          timerange("open_time", "close_time", '[)') WITH &&
        )
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_resources_is_active" ON "resources" ("is_active")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_schedules_resource_id" ON "resource_schedules" ("resource_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_resource_schedules_resource_id"`);
    await queryRunner.query(`DROP INDEX "IDX_resources_is_active"`);
    await queryRunner.query(`DROP TABLE "resource_schedules"`);
    await queryRunner.query(`DROP TABLE "resources"`);
    await queryRunner.query(`DROP TYPE "timerange"`);
  }
}
