import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  type EntityManager,
  type FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import type { JwtPayload } from '../auth/types/jwt-payload.type.js';
import { Resource } from '../resources/resource.entity.js';
import { UserRole } from '../users/user-role.enum.js';
import type { CreateReservationDto } from './dto/create-reservation.dto.js';
import type { FindReservationsQueryDto } from './dto/find-reservations-query.dto.js';
import type { RescheduleReservationDto } from './dto/reschedule-reservation.dto.js';
import type { ReservationResponseDto } from './dto/reservation-response.dto.js';
import { ReservationStatus } from './reservation-status.enum.js';
import { Reservation } from './reservation.entity.js';

const POSTGRES_EXCLUSION_VIOLATION_CODE = '23P01';
const POSTGRES_CHECK_VIOLATION_CODE = '23514';

function getPostgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('code' in error) {
    return (error as { code?: unknown }).code as string | undefined;
  }
  // TypeORM's QueryFailedError wraps the raw pg driver error rather than
  // exposing `code` directly on itself.
  const driverError = (error as { driverError?: unknown }).driverError;
  if (typeof driverError === 'object' && driverError !== null && 'code' in driverError) {
    return (driverError as { code?: unknown }).code as string | undefined;
  }
  return undefined;
}

function isExclusionViolation(error: unknown): boolean {
  return getPostgresErrorCode(error) === POSTGRES_EXCLUSION_VIOLATION_CODE;
}

function isCheckViolation(error: unknown): boolean {
  return getPostgresErrorCode(error) === POSTGRES_CHECK_VIOLATION_CODE;
}

function parseTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function getUtcMinutesOfDay(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function isSameUtcCalendarDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

@Injectable()
export class ReservationsService {
  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepository: Repository<Reservation>,
    @InjectRepository(Resource)
    private readonly resourceRepository: Repository<Resource>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateReservationDto, user: JwtPayload): Promise<Reservation> {
    let reservationId: string;
    try {
      reservationId = await this.dataSource.transaction(async (manager) => {
        const startsAt = new Date(dto.startsAt);
        const endsAt = new Date(dto.endsAt);
        await this.assertBookable(manager, dto.resourceId, startsAt, endsAt);

        const saved = await manager.save(Reservation, {
          resourceId: dto.resourceId,
          userId: user.sub,
          startsAt,
          endsAt,
        });

        return saved.id;
      });
    } catch (error) {
      throw this.mapPersistenceError(error);
    }

    return this.findOne(reservationId, user);
  }

  async findAll(
    query: FindReservationsQueryDto,
    user: JwtPayload,
  ): Promise<Reservation[]> {
    // Ownership can never be client-supplied: a USER's `userId` filter
    // (foreign or own) is always overwritten with their own sub; only
    // ADMIN's `userId` filter is honoured (omitted = all users).
    const effectiveUserId = user.role === UserRole.ADMIN ? query.userId : user.sub;

    const where: FindOptionsWhere<Reservation> = {
      status: query.status ?? ReservationStatus.CONFIRMED,
      endsAt: MoreThanOrEqual(query.from ? new Date(query.from) : new Date()),
    };

    if (effectiveUserId !== undefined) where.userId = effectiveUserId;
    if (query.resourceId !== undefined) where.resourceId = query.resourceId;
    if (query.to !== undefined) where.startsAt = LessThanOrEqual(new Date(query.to));

    return this.reservationRepository.find({
      where,
      order: { startsAt: 'ASC' },
    });
  }

  async findOne(id: string, user: JwtPayload): Promise<Reservation> {
    const reservation = await this.reservationRepository.findOne({
      where: { id },
    });

    if (!reservation) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }

    this.assertOwnerOrAdmin(reservation, user);

    return reservation;
  }

  async cancel(id: string, user: JwtPayload): Promise<Reservation> {
    await this.findOne(id, user);
    // Soft UPDATE only — never DELETE — and unrestricted in time: cancelling
    // a future, in-progress, or already-ended reservation all succeed.
    await this.reservationRepository.update(id, {
      status: ReservationStatus.CANCELLED,
    });
    return this.findOne(id, user);
  }

  async reschedule(
    id: string,
    dto: RescheduleReservationDto,
    user: JwtPayload,
  ): Promise<Reservation> {
    const reservation = await this.findOne(id, user);

    try {
      await this.dataSource.transaction(async (manager) => {
        const startsAt = new Date(dto.startsAt);
        const endsAt = new Date(dto.endsAt);
        await this.assertBookable(manager, reservation.resourceId, startsAt, endsAt);
        // One targeted UPDATE on the same row, inside one transaction. On a
        // genuine conflict with a different reservation, the EXCLUDE
        // constraint aborts the statement (and the transaction), so the row
        // keeps its original times — reschedule is all-or-nothing. It never
        // self-conflicts against its own prior version because Postgres's
        // dirty-snapshot exclusion scan skips any tuple whose `xmax` belongs
        // to the current transaction.
        await manager.update(Reservation, id, { startsAt, endsAt });
      });
    } catch (error) {
      throw this.mapPersistenceError(error);
    }

    return this.findOne(id, user);
  }

  toResponse(reservation: Reservation): ReservationResponseDto {
    return {
      id: reservation.id,
      resourceId: reservation.resourceId,
      userId: reservation.userId,
      startsAt: reservation.startsAt,
      endsAt: reservation.endsAt,
      status: reservation.status,
      createdAt: reservation.createdAt,
      updatedAt: reservation.updatedAt,
    };
  }

  // Non-owner, non-admin callers get 403 (ForbiddenException) — never 404 —
  // for both a missing-vs-foreign distinction. This project's authorization
  // semantics reserve 403 for permission failures (matching the existing
  // fail-closed RolesGuard), so this deliberately does not attempt to hide
  // whether a foreign reservation id exists.
  private assertOwnerOrAdmin(reservation: Reservation, user: JwtPayload): void {
    if (user.role !== UserRole.ADMIN && reservation.userId !== user.sub) {
      throw new ForbiddenException(
        'You do not have access to this reservation',
      );
    }
  }

  // Shared by create() and reschedule(), always called inside the caller's
  // transaction so the resource read and the reservation write land on one
  // snapshot. Every failure here is a BadRequestException except a missing
  // resource, which is a genuine 404.
  private async assertBookable(
    manager: EntityManager,
    resourceId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<void> {
    const resource = await manager.findOne(Resource, {
      where: { id: resourceId },
      relations: { schedules: true },
    });

    if (!resource) {
      throw new NotFoundException(`Resource ${resourceId} not found`);
    }

    if (!resource.isActive) {
      throw new BadRequestException('Resource is not active');
    }

    if (!(endsAt.getTime() > startsAt.getTime())) {
      throw new BadRequestException('endsAt must be after startsAt');
    }

    if (!(startsAt.getTime() > Date.now())) {
      throw new BadRequestException('startsAt must be in the future');
    }

    if (!isSameUtcCalendarDate(startsAt, endsAt)) {
      throw new BadRequestException(
        'Reservation cannot cross midnight (UTC)',
      );
    }

    const dayOfWeek = startsAt.getUTCDay();
    const startMinutes = getUtcMinutesOfDay(startsAt);
    const endMinutes = getUtcMinutesOfDay(endsAt);

    const containingSchedule = (resource.schedules ?? []).find((schedule) => {
      if (schedule.dayOfWeek !== dayOfWeek) return false;
      const openMinutes = parseTimeToMinutes(schedule.openTime);
      const closeMinutes = parseTimeToMinutes(schedule.closeTime);
      return openMinutes <= startMinutes && endMinutes <= closeMinutes;
    });

    if (!containingSchedule) {
      throw new BadRequestException(
        'Reservation is outside any schedule window for that day',
      );
    }

    const durationMinutes = (endsAt.getTime() - startsAt.getTime()) / 60_000;
    if (
      durationMinutes < resource.minBookingMinutes ||
      durationMinutes > resource.maxBookingMinutes
    ) {
      throw new BadRequestException(
        "Reservation duration is outside the resource's allowed range",
      );
    }
  }

  private mapPersistenceError(error: unknown): unknown {
    if (isExclusionViolation(error)) {
      return new ConflictException(
        'Resource is already booked for that time range',
      );
    }
    if (isCheckViolation(error)) {
      return new BadRequestException(
        'Reservation time range violates a database constraint',
      );
    }
    return error;
  }
}
