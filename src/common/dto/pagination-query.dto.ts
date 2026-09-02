// class-transformer's @Type() decorator unconditionally calls
// Reflect.getMetadata, so this file must polyfill it itself rather than
// relying on @nestjs/common's transitive side-effect import (which is not
// guaranteed when this DTO is imported in isolation, e.g. by a unit spec).
import 'reflect-metadata';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
