import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import type { JwtPayload } from '../auth/types/jwt-payload.type.js';
import type { Resource } from '../resources/resource.entity.js';
import type { ResourceSchedule } from '../resources/resource-schedule.entity.js';
import { UserRole } from '../users/user-role.enum.js';
import { ReservationStatus } from './reservation-status.enum.js';
import { Reservation } from './reservation.entity.js';
import { ReservationsService } from './reservations.service.js';

function createMockManager() {
  return {
    findOne: vi.fn(),
    save: vi.fn(async (_entity: unknown, data: Record<string, unknown>) => ({
      id: 'reservation-1',
      ...data,
    })),
    update: vi.fn(async () => ({ affected: 1 })),
  };
}

function createMockDataSource(manager: ReturnType<typeof createMockManager>) {
  return {
    transaction: vi.fn(async (cb: (manager: unknown) => unknown) => cb(manager)),
  } as unknown as DataSource;
}

function createMockReservationRepository(): Repository<Reservation> {
  return {
    findOne: vi.fn(),
    find: vi.fn(),
    update: vi.fn(async () => ({ affected: 1 })),
  } as unknown as Repository<Reservation>;
}

function createMockResourceRepository(): Repository<Resource> {
  return {} as unknown as Repository<Resource>;
}

function futureWindow(daysFromNow: number, startHour: number, endHour: number) {
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + daysFromNow);
  startsAt.setUTCHours(startHour, 0, 0, 0);
  const endsAt = new Date(startsAt);
  endsAt.setUTCHours(endHour, 0, 0, 0);
  return { startsAt, endsAt, dayOfWeek: startsAt.getUTCDay() };
}

function baseResource(overrides: Partial<Resource> = {}): Resource {
  const { dayOfWeek } = futureWindow(60, 9, 10);
  return {
    id: 'resource-1',
    name: 'Room A',
    capacity: 4,
    isActive: true,
    minBookingMinutes: 30,
    maxBookingMinutes: 120,
    notes: null,
    amenities: [],
    schedules: [
      {
        id: 'sched-1',
        resourceId: 'resource-1',
        dayOfWeek,
        openTime: '09:00',
        closeTime: '12:00',
      } as ResourceSchedule,
    ],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as Resource;
}

function baseReservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: 'reservation-1',
    resourceId: 'resource-1',
    userId: 'user-1',
    startsAt: new Date('2027-01-04T09:00:00.000Z'),
    endsAt: new Date('2027-01-04T10:00:00.000Z'),
    status: ReservationStatus.CONFIRMED,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as Reservation;
}

const adminUser: JwtPayload = { sub: 'admin-1', role: UserRole.ADMIN };
const ownerUser: JwtPayload = { sub: 'user-1', role: UserRole.USER };
const foreignUser: JwtPayload = { sub: 'user-2', role: UserRole.USER };

describe('ReservationsService', () => {
  describe('assertBookable branches (exercised via create())', () => {
    it('throws NotFoundException when the target resource does not exist', async () => {
      const manager = createMockManager();
      manager.findOne.mockResolvedValue(null);
      const dataSource = createMockDataSource(manager);
      const service = new ReservationsService(
        createMockReservationRepository(),
        createMockResourceRepository(),
        dataSource,
      );
      const { startsAt, endsAt } = futureWindow(60, 9, 10);

      await expect(
        service.create(
          {
            resourceId: 'resource-1',
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          },
          ownerUser,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException for an inactive resource', async () => {
      const manager = createMockManager();
      manager.findOne.mockResolvedValue(baseResource({ isActive: false }));
      const dataSource = createMockDataSource(manager);
      const service = new ReservationsService(
        createMockReservationRepository(),
        createMockResourceRepository(),
        dataSource,
      );
      const { startsAt, endsAt } = futureWindow(60, 9, 10);

      await expect(
        service.create(
          {
            resourceId: 'resource-1',
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          },
          ownerUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when startsAt is in the past', async () => {
      const manager = createMockManager();
      manager.findOne.mockResolvedValue(baseResource());
      const dataSource = createMockDataSource(manager);
      const service = new ReservationsService(
        createMockReservationRepository(),
        createMockResourceRepository(),
        dataSource,
      );
      const past = new Date();
      past.setUTCDate(past.getUTCDate() - 1);

      await expect(
        service.create(
          {
            resourceId: 'resource-1',
            startsAt: past.toISOString(),
            endsAt: new Date().toISOString(),
          },
          ownerUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when endsAt <= startsAt', async () => {
      const manager = createMockManager();
      manager.findOne.mockResolvedValue(baseResource());
      const dataSource = createMockDataSource(manager);
      const service = new ReservationsService(
        createMockReservationRepository(),
        createMockResourceRepository(),
        dataSource,
      );
      const { startsAt } = futureWindow(60, 9, 10);

      await expect(
        service.create(
          {
            resourceId: 'resource-1',
            startsAt: startsAt.toISOString(),
            endsAt: startsAt.toISOString(),
          },
          ownerUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when the range crosses midnight (UTC)', async () => {
      const manager = createMockManager();
      manager.findOne.mockResolvedValue(baseResource());
      const dataSource = createMockDataSource(manager);
      const service = new ReservationsService(
        createMockReservationRepository(),
        createMockResourceRepository(),
        dataSource,
      );
      const { startsAt } = futureWindow(60, 23, 23);
      const endsAt = new Date(startsAt);
      endsAt.setUTCDate(endsAt.getUTCDate() + 1);
      endsAt.setUTCHours(1, 0, 0, 0);

      await expect(
        service.create(
          {
            resourceId: 'resource-1',
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          },
          ownerUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when no schedule exists for that day of week', async () => {
      const manager = createMockManager();
      const { startsAt, endsAt, dayOfWeek } = futureWindow(60, 9, 10);
      const wrongDay = (dayOfWeek + 1) % 7;
      manager.findOne.mockResolvedValue(
        baseResource({
          schedules: [
            {
              id: 'sched-1',
              resourceId: 'resource-1',
              dayOfWeek: wrongDay,
              openTime: '09:00',
              closeTime: '12:00',
            } as ResourceSchedule,
          ],
        }),
      );
      const dataSource = createMockDataSource(manager);
      const service = new ReservationsService(
        createMockReservationRepository(),
        createMockResourceRepository(),
        dataSource,
      );

      await expect(
        service.create(
          {
            resourceId: 'resource-1',
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          },
          ownerUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when the range is only partially inside the schedule window', async () => {
      const manager = createMockManager();
      const { dayOfWeek } = futureWindow(60, 9, 10);
      manager.findOne.mockResolvedValue(
        baseResource({
          schedules: [
            {
              id: 'sched-1',
              resourceId: 'resource-1',
              dayOfWeek,
              openTime: '09:00',
              closeTime: '12:00',
            } as ResourceSchedule,
          ],
        }),
      );
      const dataSource = createMockDataSource(manager);
      const service = new ReservationsService(
        createMockReservationRepository(),
        createMockResourceRepository(),
        dataSource,
      );
      const { startsAt, endsAt } = futureWindow(60, 11, 13); // window ends 12:00

      await expect(
        service.create(
          {
            resourceId: 'resource-1',
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          },
          ownerUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when duration is below minBookingMinutes', async () => {
      const manager = createMockManager();
      manager.findOne.mockResolvedValue(
        baseResource({ minBookingMinutes: 60, maxBookingMinutes: 120 }),
      );
      const dataSource = createMockDataSource(manager);
      const service = new ReservationsService(
        createMockReservationRepository(),
        createMockResourceRepository(),
        dataSource,
      );
      const startsAt = futureWindow(60, 9, 10).startsAt;
      const endsAt = new Date(startsAt);
      endsAt.setUTCMinutes(endsAt.getUTCMinutes() + 20);

      await expect(
        service.create(
          {
            resourceId: 'resource-1',
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          },
          ownerUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when duration exceeds maxBookingMinutes', async () => {
      const manager = createMockManager();
      manager.findOne.mockResolvedValue(
        baseResource({ minBookingMinutes: 30, maxBookingMinutes: 60 }),
      );
      const dataSource = createMockDataSource(manager);
      const service = new ReservationsService(
        createMockReservationRepository(),
        createMockResourceRepository(),
        dataSource,
      );
      const { startsAt, endsAt } = futureWindow(60, 9, 12); // 3h duration > 60m max, still inside 09-12 window

      await expect(
        service.create(
          {
            resourceId: 'resource-1',
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          },
          ownerUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('create — happy path', () => {
    it('persists the reservation with the caller as owner inside one transaction', async () => {
      const manager = createMockManager();
      manager.findOne.mockResolvedValue(baseResource());
      const dataSource = createMockDataSource(manager);
      const reservationRepository = createMockReservationRepository();
      (reservationRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseReservation(),
      );
      const service = new ReservationsService(
        reservationRepository,
        createMockResourceRepository(),
        dataSource,
      );
      const { startsAt, endsAt } = futureWindow(60, 9, 10);

      const result = await service.create(
        {
          resourceId: 'resource-1',
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
        ownerUser,
      );

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.save).toHaveBeenCalledWith(
        Reservation,
        expect.objectContaining({ resourceId: 'resource-1', userId: 'user-1' }),
      );
      expect(result).toBeDefined();
    });
  });

  describe('mapPersistenceError (via create())', () => {
    it('maps a 23P01 exclusion violation to ConflictException', async () => {
      const dataSource = {
        transaction: vi.fn(async () => {
          throw { code: '23P01' };
        }),
      } as unknown as DataSource;
      const service = new ReservationsService(
        createMockReservationRepository(),
        createMockResourceRepository(),
        dataSource,
      );
      const { startsAt, endsAt } = futureWindow(60, 9, 10);

      await expect(
        service.create(
          {
            resourceId: 'resource-1',
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          },
          ownerUser,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps a 23514 check violation to BadRequestException', async () => {
      const dataSource = {
        transaction: vi.fn(async () => {
          throw { code: '23514' };
        }),
      } as unknown as DataSource;
      const service = new ReservationsService(
        createMockReservationRepository(),
        createMockResourceRepository(),
        dataSource,
      );
      const { startsAt, endsAt } = futureWindow(60, 9, 10);

      await expect(
        service.create(
          {
            resourceId: 'resource-1',
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          },
          ownerUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findAll', () => {
    it("forces where.userId to the caller's own sub for a USER, ignoring a foreign userId filter", async () => {
      const reservationRepository = createMockReservationRepository();
      (reservationRepository.find as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const service = new ReservationsService(
        reservationRepository,
        createMockResourceRepository(),
        createMockDataSource(createMockManager()),
      );

      await service.findAll({ userId: 'user-2' }, ownerUser);

      expect(reservationRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1' }),
        }),
      );
    });

    it('honours the userId filter for ADMIN', async () => {
      const reservationRepository = createMockReservationRepository();
      (reservationRepository.find as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const service = new ReservationsService(
        reservationRepository,
        createMockResourceRepository(),
        createMockDataSource(createMockManager()),
      );

      await service.findAll({ userId: 'user-2' }, adminUser);

      expect(reservationRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-2' }),
        }),
      );
    });

    it('omits the userId filter for ADMIN when not provided (all users)', async () => {
      const reservationRepository = createMockReservationRepository();
      (reservationRepository.find as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const service = new ReservationsService(
        reservationRepository,
        createMockResourceRepository(),
        createMockDataSource(createMockManager()),
      );

      await service.findAll({}, adminUser);

      const callArgs = (reservationRepository.find as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(callArgs.where.userId).toBeUndefined();
    });

    it('defaults to confirmed + upcoming when no filters are supplied', async () => {
      const reservationRepository = createMockReservationRepository();
      (reservationRepository.find as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const service = new ReservationsService(
        reservationRepository,
        createMockResourceRepository(),
        createMockDataSource(createMockManager()),
      );

      await service.findAll({}, adminUser);

      expect(reservationRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: ReservationStatus.CONFIRMED }),
        }),
      );
    });
  });

  describe('findOne / assertOwnerOrAdmin', () => {
    it('throws NotFoundException when the reservation does not exist', async () => {
      const reservationRepository = createMockReservationRepository();
      (reservationRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const service = new ReservationsService(
        reservationRepository,
        createMockResourceRepository(),
        createMockDataSource(createMockManager()),
      );

      await expect(service.findOne('missing-id', ownerUser)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ForbiddenException for a foreign non-admin caller', async () => {
      const reservationRepository = createMockReservationRepository();
      (reservationRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseReservation({ userId: 'user-1' }),
      );
      const service = new ReservationsService(
        reservationRepository,
        createMockResourceRepository(),
        createMockDataSource(createMockManager()),
      );

      await expect(
        service.findOne('reservation-1', foreignUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns the reservation for its owner', async () => {
      const reservationRepository = createMockReservationRepository();
      (reservationRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseReservation({ userId: 'user-1' }),
      );
      const service = new ReservationsService(
        reservationRepository,
        createMockResourceRepository(),
        createMockDataSource(createMockManager()),
      );

      const result = await service.findOne('reservation-1', ownerUser);

      expect(result.id).toBe('reservation-1');
    });

    it('returns any reservation for ADMIN', async () => {
      const reservationRepository = createMockReservationRepository();
      (reservationRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseReservation({ userId: 'user-1' }),
      );
      const service = new ReservationsService(
        reservationRepository,
        createMockResourceRepository(),
        createMockDataSource(createMockManager()),
      );

      const result = await service.findOne('reservation-1', adminUser);

      expect(result.id).toBe('reservation-1');
    });
  });

  describe('cancel', () => {
    it('soft-updates status to cancelled', async () => {
      const reservationRepository = createMockReservationRepository();
      (reservationRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseReservation({ userId: 'user-1' }),
      );
      const service = new ReservationsService(
        reservationRepository,
        createMockResourceRepository(),
        createMockDataSource(createMockManager()),
      );

      await service.cancel('reservation-1', ownerUser);

      expect(reservationRepository.update).toHaveBeenCalledWith('reservation-1', {
        status: ReservationStatus.CANCELLED,
      });
    });

    it('succeeds with no temporal restriction for an already-past reservation', async () => {
      const reservationRepository = createMockReservationRepository();
      (reservationRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseReservation({
          userId: 'user-1',
          startsAt: new Date('2020-01-01T09:00:00.000Z'),
          endsAt: new Date('2020-01-01T10:00:00.000Z'),
        }),
      );
      const service = new ReservationsService(
        reservationRepository,
        createMockResourceRepository(),
        createMockDataSource(createMockManager()),
      );

      await expect(service.cancel('reservation-1', ownerUser)).resolves.toBeDefined();
    });

    it('throws ForbiddenException when a non-owner non-admin attempts to cancel', async () => {
      const reservationRepository = createMockReservationRepository();
      (reservationRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseReservation({ userId: 'user-1' }),
      );
      const service = new ReservationsService(
        reservationRepository,
        createMockResourceRepository(),
        createMockDataSource(createMockManager()),
      );

      await expect(
        service.cancel('reservation-1', foreignUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(reservationRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('reschedule', () => {
    it('reruns assertBookable and updates the same row via manager.update, never touching resourceId', async () => {
      const manager = createMockManager();
      manager.findOne.mockResolvedValue(baseResource());
      const dataSource = createMockDataSource(manager);
      const reservationRepository = createMockReservationRepository();
      (reservationRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseReservation({ userId: 'user-1' }),
      );
      const service = new ReservationsService(
        reservationRepository,
        createMockResourceRepository(),
        dataSource,
      );
      const { startsAt, endsAt } = futureWindow(60, 9, 10);

      await service.reschedule(
        'reservation-1',
        { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
        ownerUser,
      );

      expect(manager.findOne).toHaveBeenCalled(); // assertBookable re-ran
      expect(manager.update).toHaveBeenCalledWith(
        Reservation,
        'reservation-1',
        { startsAt, endsAt },
      );
    });

    it('throws ForbiddenException before ever touching the transaction for a foreign non-admin caller', async () => {
      const manager = createMockManager();
      const dataSource = createMockDataSource(manager);
      const reservationRepository = createMockReservationRepository();
      (reservationRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseReservation({ userId: 'user-1' }),
      );
      const service = new ReservationsService(
        reservationRepository,
        createMockResourceRepository(),
        dataSource,
      );
      const { startsAt, endsAt } = futureWindow(60, 9, 10);

      await expect(
        service.reschedule(
          'reservation-1',
          { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
          foreignUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('maps a reschedule conflict (23P01) to ConflictException', async () => {
      const reservationRepository = createMockReservationRepository();
      (reservationRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseReservation({ userId: 'user-1' }),
      );
      const dataSource = {
        transaction: vi.fn(async () => {
          throw { code: '23P01' };
        }),
      } as unknown as DataSource;
      const service = new ReservationsService(
        reservationRepository,
        createMockResourceRepository(),
        dataSource,
      );
      const { startsAt, endsAt } = futureWindow(60, 9, 10);

      await expect(
        service.reschedule(
          'reservation-1',
          { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
          ownerUser,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('toResponse', () => {
    it('maps a reservation to the response shape', () => {
      const service = new ReservationsService(
        createMockReservationRepository(),
        createMockResourceRepository(),
        createMockDataSource(createMockManager()),
      );
      const reservation = baseReservation();

      const response = service.toResponse(reservation);

      expect(response).toEqual({
        id: reservation.id,
        resourceId: reservation.resourceId,
        userId: reservation.userId,
        startsAt: reservation.startsAt,
        endsAt: reservation.endsAt,
        status: reservation.status,
        createdAt: reservation.createdAt,
        updatedAt: reservation.updatedAt,
      });
    });
  });
});
