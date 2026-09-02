import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, MoreThan, Repository } from 'typeorm';
import {
  buildPaginationMeta,
  type PaginatedResult,
} from '../common/dto/paginated-response.dto.js';
import { ReservationStatus } from '../reservations/reservation-status.enum.js';
import { Reservation } from '../reservations/reservation.entity.js';
import type { CreateResourceDto } from './dto/create-resource.dto.js';
import type { FreeIntervalDto } from './dto/resource-availability-response.dto.js';
import type { ResourceResponseDto } from './dto/resource-response.dto.js';
import type { UpdateResourceDto } from './dto/update-resource.dto.js';
import { computeFreeIntervals } from './resource-availability.util.js';
import { ResourceSchedule } from './resource-schedule.entity.js';
import { Resource } from './resource.entity.js';
import { MAX_AVAILABILITY_RANGE_DAYS, SLOT_INTERVAL_MINUTES } from './resources.constants.js';

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

interface ScheduleRow {
  resourceId: string;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
}

@Injectable()
export class ResourcesService {
  constructor(
    @InjectRepository(Resource)
    private readonly resourceRepository: Repository<Resource>,
    @InjectRepository(ResourceSchedule)
    private readonly scheduleRepository: Repository<ResourceSchedule>,
    @InjectRepository(Reservation)
    private readonly reservationRepository: Repository<Reservation>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateResourceDto): Promise<Resource> {
    this.validateBookingMinutes(dto.minBookingMinutes, dto.maxBookingMinutes);

    let resourceId: string;
    try {
      resourceId = await this.dataSource.transaction(async (manager) => {
        const saved = await manager.save(Resource, {
          name: dto.name,
          capacity: dto.capacity,
          minBookingMinutes: dto.minBookingMinutes,
          maxBookingMinutes: dto.maxBookingMinutes,
          notes: dto.notes ?? null,
          amenities: dto.amenities ?? [],
        });

        if (dto.schedules && dto.schedules.length > 0) {
          await manager.insert(
            ResourceSchedule,
            this.toScheduleRows(saved.id, dto.schedules),
          );
        }

        return saved.id;
      });
    } catch (error) {
      throw this.mapPersistenceError(error);
    }

    return this.findOne(resourceId);
  }

  async findAll(
    includeInactive: boolean,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<Resource>> {
    const [data, total] = await this.resourceRepository.findAndCount({
      where: includeInactive ? {} : { isActive: true },
      relations: { schedules: true },
      order: { createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string): Promise<Resource> {
    const resource = await this.resourceRepository.findOne({
      where: { id },
      relations: { schedules: true },
    });

    if (!resource) {
      throw new NotFoundException(`Resource ${id} not found`);
    }

    return resource;
  }

  async update(id: string, dto: UpdateResourceDto): Promise<Resource> {
    await this.findOne(id);

    this.validateBookingMinutes(dto.minBookingMinutes, dto.maxBookingMinutes);

    const scalarFields = this.extractScalarFields(dto);

    try {
      await this.dataSource.transaction(async (manager) => {
        if (Object.keys(scalarFields).length > 0) {
          await manager.update(Resource, id, scalarFields);
        }

        // Replace-semantics boundary: `dto.schedules` is undefined when the
        // key was absent from the PATCH body (existing windows untouched).
        // Any defined array — including [] — fully replaces them in one
        // delete-then-insert pass within this same transaction, so a
        // rejected insert (EXCLUDE violation) rolls back the delete too.
        if (dto.schedules !== undefined) {
          await manager.delete(ResourceSchedule, { resourceId: id });

          if (dto.schedules.length > 0) {
            await manager.insert(
              ResourceSchedule,
              this.toScheduleRows(id, dto.schedules),
            );
          }
        }
      });
    } catch (error) {
      throw this.mapPersistenceError(error);
    }

    return this.findOne(id);
  }

  async deactivate(id: string): Promise<Resource> {
    await this.findOne(id);
    await this.resourceRepository.update(id, { isActive: false });
    return this.findOne(id);
  }

  async getAvailability(
    id: string,
    from: string,
    to: string,
  ): Promise<{ resourceId: string; from: Date; to: Date; freeIntervals: FreeIntervalDto[] }> {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (!(toDate.getTime() > fromDate.getTime())) {
      throw new BadRequestException('to must be after from');
    }

    const rangeDays = (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000);
    if (rangeDays > MAX_AVAILABILITY_RANGE_DAYS) {
      throw new BadRequestException(
        `Availability range cannot exceed ${MAX_AVAILABILITY_RANGE_DAYS} days`,
      );
    }

    const resource = await this.findOne(id);

    // An inactive resource can never be booked (assertBookable rejects it in
    // ReservationsService), so it has no free intervals regardless of schedule.
    if (!resource.isActive) {
      return { resourceId: id, from: fromDate, to: toDate, freeIntervals: [] };
    }

    const confirmedReservations = await this.reservationRepository.find({
      where: {
        resourceId: id,
        status: ReservationStatus.CONFIRMED,
        startsAt: LessThan(toDate),
        endsAt: MoreThan(fromDate),
      },
    });

    const freeIntervals = computeFreeIntervals(
      resource.schedules ?? [],
      confirmedReservations,
      fromDate,
      toDate,
    ).map((interval) => ({ startsAt: interval.start, endsAt: interval.end }));

    return { resourceId: id, from: fromDate, to: toDate, freeIntervals };
  }

  toResponse(resource: Resource): ResourceResponseDto {
    return {
      id: resource.id,
      name: resource.name,
      capacity: resource.capacity,
      isActive: resource.isActive,
      minBookingMinutes: resource.minBookingMinutes,
      maxBookingMinutes: resource.maxBookingMinutes,
      notes: resource.notes,
      amenities: resource.amenities,
      schedules: (resource.schedules ?? []).map((schedule) => ({
        id: schedule.id,
        dayOfWeek: schedule.dayOfWeek,
        openTime: schedule.openTime,
        closeTime: schedule.closeTime,
      })),
      createdAt: resource.createdAt,
      updatedAt: resource.updatedAt,
    };
  }

  private toScheduleRows(
    resourceId: string,
    schedules: { dayOfWeek: number; openTime: string; closeTime: string }[],
  ): ScheduleRow[] {
    return schedules.map((schedule) => ({
      resourceId,
      dayOfWeek: schedule.dayOfWeek,
      openTime: schedule.openTime,
      closeTime: schedule.closeTime,
    }));
  }

  private extractScalarFields(
    dto: UpdateResourceDto,
  ): Partial<
    Pick<
      Resource,
      | 'name'
      | 'capacity'
      | 'minBookingMinutes'
      | 'maxBookingMinutes'
      | 'notes'
      | 'amenities'
    >
  > {
    const fields: Partial<
      Pick<
        Resource,
        | 'name'
        | 'capacity'
        | 'minBookingMinutes'
        | 'maxBookingMinutes'
        | 'notes'
        | 'amenities'
      >
    > = {};

    if (dto.name !== undefined) fields.name = dto.name;
    if (dto.capacity !== undefined) fields.capacity = dto.capacity;
    if (dto.minBookingMinutes !== undefined)
      fields.minBookingMinutes = dto.minBookingMinutes;
    if (dto.maxBookingMinutes !== undefined)
      fields.maxBookingMinutes = dto.maxBookingMinutes;
    if (dto.notes !== undefined) fields.notes = dto.notes;
    if (dto.amenities !== undefined) fields.amenities = dto.amenities;

    return fields;
  }

  // Defense-in-depth alongside the DB CHECK constraints: catches invalid
  // booking-minutes combinations before they ever reach Postgres. Only
  // validates a cross-field (max >= min) relationship when BOTH values are
  // present in this call — a partial PATCH supplying only one of the pair
  // is validated against the other's DB-persisted value by the CHECK
  // constraint itself, not re-fetched here.
  private validateBookingMinutes(min: number | undefined, max: number | undefined): void {
    if (min !== undefined) {
      if (min < SLOT_INTERVAL_MINUTES || min % SLOT_INTERVAL_MINUTES !== 0) {
        throw new BadRequestException(
          `minBookingMinutes must be >= ${SLOT_INTERVAL_MINUTES} and a multiple of ${SLOT_INTERVAL_MINUTES}`,
        );
      }
    }

    if (max !== undefined && max % SLOT_INTERVAL_MINUTES !== 0) {
      throw new BadRequestException(
        `maxBookingMinutes must be a multiple of ${SLOT_INTERVAL_MINUTES}`,
      );
    }

    if (min !== undefined && max !== undefined && max < min) {
      throw new BadRequestException(
        'maxBookingMinutes must be greater than or equal to minBookingMinutes',
      );
    }
  }

  private mapPersistenceError(error: unknown): unknown {
    if (isExclusionViolation(error)) {
      return new ConflictException(
        'Schedule windows overlap for the same day',
      );
    }
    if (isCheckViolation(error)) {
      return new BadRequestException(
        'Schedule window or resource field violates a database constraint',
      );
    }
    return error;
  }
}
