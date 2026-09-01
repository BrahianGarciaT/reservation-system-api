// class-transformer's @Transform() decorator relies on the same
// Reflect.getMetadata polyfill as @Type() — see create-resource.dto.ts.
import 'reflect-metadata';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

function toOptionalBoolean(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class ListResourcesQueryDto {
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  includeInactive?: boolean;
}
