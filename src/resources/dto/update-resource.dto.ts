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
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { SLOT_INTERVAL_MINUTES } from '../resources.constants.js';
import { ScheduleWindowDto } from './schedule-window.dto.js';

@ValidatorConstraint({ name: 'isMultipleOfSlotIntervalOptional', async: false })
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

export class UpdateResourceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsInt()
  @Min(SLOT_INTERVAL_MINUTES)
  @Validate(IsMultipleOfSlotIntervalConstraint)
  minBookingMinutes?: number;

  @IsOptional()
  @IsInt()
  @Validate(IsMultipleOfSlotIntervalConstraint)
  maxBookingMinutes?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  // Replace-semantics discriminator (design decision, SETTLED):
  // - key absent -> undefined -> ValidateIf skips -> schedules left untouched
  // - schedules: []           -> defined empty array -> passes -> clears all windows
  // - schedules: null         -> ValidateIf does NOT skip (null !== undefined) ->
  //                              @IsArray() runs and rejects it with a 400
  // Deliberately NOT @IsOptional(), which also skips `null` and would leak
  // `null` into the service instead of rejecting it at the HTTP boundary.
  @ValidateIf((o: UpdateResourceDto) => o.schedules !== undefined)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleWindowDto)
  schedules?: ScheduleWindowDto[];
}
