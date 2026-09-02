import { IsISO8601, IsUUID } from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  resourceId: string;

  @IsISO8601({ strict: true })
  startsAt: string;

  @IsISO8601({ strict: true })
  endsAt: string;
}
