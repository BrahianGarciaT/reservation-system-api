import { IsISO8601 } from 'class-validator';

// Both fields are required (whole-window replace): a single-field reschedule
// is rejected because it would make the resulting window ambiguous and would
// force a read-before-validate step outside the transaction. No `resourceId`
// field is declared — reschedule is time-only and never changes the
// resource; the global `ValidationPipe`'s `forbidNonWhitelisted: true`
// rejects any caller-supplied `resourceId`.
export class RescheduleReservationDto {
  @IsISO8601({ strict: true })
  startsAt: string;

  @IsISO8601({ strict: true })
  endsAt: string;
}
