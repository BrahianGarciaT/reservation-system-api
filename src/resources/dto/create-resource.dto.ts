// class-transformer's @Type() decorator unconditionally calls
// Reflect.getMetadata, so this file must polyfill it itself rather than
// relying on @nestjs/common's transitive side-effect import (which is not
// guaranteed when this DTO is imported in isolation, e.g. by a unit spec).
import 'reflect-metadata';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { SLOT_INTERVAL_MINUTES } from '../resources.constants.js';
import { ScheduleWindowDto } from './schedule-window.dto.js';

@ValidatorConstraint({ name: 'isMultipleOfSlotInterval', async: false })
class IsMultipleOfSlotIntervalConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown): boolean {
    return typeof value === 'number' && value % SLOT_INTERVAL_MINUTES === 0;
  }

  defaultMessage(): string {
    return `$property must be a multiple of ${SLOT_INTERVAL_MINUTES}`;
  }
}

@ValidatorConstraint({ name: 'isGreaterOrEqualToMinBookingMinutes', async: false })
class IsGreaterOrEqualToMinBookingMinutesConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown, args: ValidationArguments): boolean {
    const object = args.object as { minBookingMinutes?: unknown };
    return (
      typeof value === 'number' &&
      typeof object.minBookingMinutes === 'number' &&
      value >= object.minBookingMinutes
    );
  }

  defaultMessage(): string {
    return 'maxBookingMinutes must be greater than or equal to minBookingMinutes';
  }
}

export class CreateResourceDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsInt()
  @Min(1)
  capacity: number;

  @IsInt()
  @Min(SLOT_INTERVAL_MINUTES)
  @Validate(IsMultipleOfSlotIntervalConstraint)
  minBookingMinutes: number;

  @IsInt()
  @Validate(IsMultipleOfSlotIntervalConstraint)
  @Validate(IsGreaterOrEqualToMinBookingMinutesConstraint)
  maxBookingMinutes: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleWindowDto)
  schedules?: ScheduleWindowDto[];
}
