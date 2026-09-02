export interface FreeInterval {
  startsAt: Date;
  endsAt: Date;
}

export class ResourceAvailabilityResponseDto {
  resourceId: string;
  from: Date;
  to: Date;
  freeIntervals: FreeInterval[];
}
