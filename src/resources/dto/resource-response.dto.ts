export class ScheduleResponseDto {
  id: string;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
}

export class ResourceResponseDto {
  id: string;
  name: string;
  capacity: number;
  isActive: boolean;
  minBookingMinutes: number;
  maxBookingMinutes: number;
  notes: string | null;
  amenities: string[];
  schedules: ScheduleResponseDto[];
  createdAt: Date;
  updatedAt: Date;
}
