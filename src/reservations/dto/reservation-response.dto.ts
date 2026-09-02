import { ReservationStatus } from '../reservation-status.enum.js';

export class ReservationResponseDto {
  id: string;
  resourceId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  status: ReservationStatus;
  createdAt: Date;
  updatedAt: Date;
}
