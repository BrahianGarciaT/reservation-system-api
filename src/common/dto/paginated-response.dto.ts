import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';

export class PaginationMeta {
  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  total: number;

  @ApiProperty()
  totalPages: number;
}

export function buildPaginationMeta(
  total: number,
  page: number,
  limit: number,
): PaginationMeta {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export class PaginatedResponseDto<T> {
  // Hidden, not just undecorated: the compiler plugin auto-annotates every
  // DTO property regardless of decorators, and a bare generic `T[]` resolves
  // to no type at all, crashing Swagger's schema builder at boot. The real
  // array type is supplied per-endpoint by ApiPaginatedResponse's schema override.
  @ApiHideProperty()
  data: T[];

  @ApiProperty()
  meta: PaginationMeta;
}
