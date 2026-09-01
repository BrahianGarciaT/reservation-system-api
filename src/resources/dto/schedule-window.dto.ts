import {
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  Validate,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

@ValidatorConstraint({ name: 'isAfterOpenTime', async: false })
class IsAfterOpenTimeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const object = args.object as { openTime?: unknown };

    // If openTime itself is malformed, @Matches(HHMM) on openTime already
    // reports that error — skip the cross-field comparison here rather than
    // stacking a second, misleading error on closeTime derived from a
    // string that isn't a valid HH:MM value in the first place.
    if (
      typeof object.openTime !== 'string' ||
      !HHMM.test(object.openTime)
    ) {
      return true;
    }

    return typeof value === 'string' && value > object.openTime;
  }

  defaultMessage(): string {
    return 'closeTime must be strictly after openTime';
  }
}

export class ScheduleWindowDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsString()
  @Matches(HHMM)
  openTime: string;

  @IsString()
  @Matches(HHMM)
  @Validate(IsAfterOpenTimeConstraint)
  closeTime: string;
}
