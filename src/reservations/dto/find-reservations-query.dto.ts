import { IsEnum, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { ReservationStatus } from '../reservation-status.enum.js';

export class FindReservationsQueryDto {
  // Honoured for ADMIN; force-overwritten to the caller's own sub for USER
  // (silent override, never an error — see ReservationsService.findAll).
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
