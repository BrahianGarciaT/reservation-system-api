import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { ReservationStatus } from '../reservations/reservation-status.enum.js';
import type { Reservation } from '../reservations/reservation.entity.js';
import { Resource } from './resource.entity.js';
import { ResourceSchedule } from './resource-schedule.entity.js';
import { ResourcesService } from './resources.service.js';

function createMockManager() {
  return {
    save: vi.fn(async (_entity: unknown, data: Record<string, unknown>) => ({
      id: 'resource-1',
      ...data,
    })),
    insert: vi.fn(async () => ({ identifiers: [] })),
    update: vi.fn(async () => ({ affected: 1 })),
    delete: vi.fn(async () => ({ affected: 0 })),
  };
}

function createMockDataSource(manager: ReturnType<typeof createMockManager>) {
  return {
    transaction: vi.fn(async (cb: (manager: unknown) => unknown) => cb(manager)),
  } as unknown as DataSource;
}

function createMockResourceRepository(): Repository<Resource> {
  return {
    findOne: vi.fn(),
    find: vi.fn(),
    findAndCount: vi.fn(async () => [[], 0]),
    update: vi.fn(async () => ({ affected: 1 })),
  } as unknown as Repository<Resource>;
}

function createMockScheduleRepository(): Repository<ResourceSchedule> {
  return {} as unknown as Repository<ResourceSchedule>;
}

function createMockReservationRepository(): Repository<Reservation> {
  return {
    find: vi.fn(async () => []),
  } as unknown as Repository<Reservation>;
}

const baseResource = (overrides: Partial<Resource> = {}): Resource =>
  ({
    id: 'resource-1',
    name: 'Room A',
    capacity: 4,
    isActive: true,
    minBookingMinutes: 30,
    maxBookingMinutes: 60,
    notes: null,
    amenities: [],
    schedules: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }) as Resource;

describe('ResourcesService', () => {
  describe('create', () => {
    it('persists the resource and its nested schedules atomically via one transaction', async () => {
      const manager = createMockManager();
      const dataSource = createMockDataSource(manager);
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseResource({
          schedules: [
            {
              id: 'sched-1',
              resourceId: 'resource-1',
              dayOfWeek: 1,
              openTime: '09:00',
              closeTime: '12:00',
            } as ResourceSchedule,
          ],
        }),
      );
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        createMockReservationRepository(),
        dataSource,
      );

      const result = await service.create({
        name: 'Room A',
        capacity: 4,
        minBookingMinutes: 30,
        maxBookingMinutes: 60,
        schedules: [{ dayOfWeek: 1, openTime: '09:00', closeTime: '12:00' }],
      });

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.save).toHaveBeenCalledWith(
        Resource,
        expect.objectContaining({ name: 'Room A', capacity: 4 }),
      );
      expect(manager.insert).toHaveBeenCalledWith(
        ResourceSchedule,
        expect.arrayContaining([
          expect.objectContaining({
            resourceId: 'resource-1',
            dayOfWeek: 1,
            openTime: '09:00',
            closeTime: '12:00',
          }),
        ]),
      );
      expect(result.schedules).toHaveLength(1);
    });

    it('does not call manager.insert when no schedules are supplied', async () => {
      const manager = createMockManager();
      const dataSource = createMockDataSource(manager);
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseResource({ schedules: [] }),
      );
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        createMockReservationRepository(),
        dataSource,
      );

      const result = await service.create({
        name: 'Room B',
        capacity: 2,
        minBookingMinutes: 30,
        maxBookingMinutes: 30,
      });

      expect(manager.insert).not.toHaveBeenCalled();
      expect(result.schedules).toHaveLength(0);
    });
  });

  describe('cross-field booking-minutes validation (create + update)', () => {
    it('create() throws BadRequestException when maxBookingMinutes < minBookingMinutes', async () => {
      const manager = createMockManager();
      const dataSource = createMockDataSource(manager);
      const service = new ResourcesService(
        createMockResourceRepository(),
        createMockScheduleRepository(),
        createMockReservationRepository(),
        dataSource,
      );

      await expect(
        service.create({
          name: 'Room C',
          capacity: 3,
          minBookingMinutes: 60,
          maxBookingMinutes: 30,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('create() throws BadRequestException when minBookingMinutes is not a multiple of 30', async () => {
      const manager = createMockManager();
      const dataSource = createMockDataSource(manager);
      const service = new ResourcesService(
        createMockResourceRepository(),
        createMockScheduleRepository(),
        createMockReservationRepository(),
        dataSource,
      );

      await expect(
        service.create({
          name: 'Room D',
          capacity: 3,
          minBookingMinutes: 45,
          maxBookingMinutes: 90,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('update() throws BadRequestException when both min and max are supplied and max < min', async () => {
      const manager = createMockManager();
      const dataSource = createMockDataSource(manager);
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseResource(),
      );
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        createMockReservationRepository(),
        dataSource,
      );

      await expect(
        service.update('resource-1', {
          minBookingMinutes: 90,
          maxBookingMinutes: 60,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('filters to isActive: true by default', async () => {
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findAndCount as ReturnType<typeof vi.fn>).mockResolvedValue([
        [baseResource()],
        1,
      ]);
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        createMockReservationRepository(),
        createMockDataSource(createMockManager()),
      );

      const result = await service.findAll(false, 1, 20);

      expect(resourceRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });

    it('returns both active and inactive resources when includeInactive is true', async () => {
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findAndCount as ReturnType<typeof vi.fn>).mockResolvedValue([
        [baseResource({ isActive: true }), baseResource({ id: 'resource-2', isActive: false })],
        2,
      ]);
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        createMockReservationRepository(),
        createMockDataSource(createMockManager()),
      );

      const result = await service.findAll(true, 1, 20);

      expect(resourceRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
      expect(result.data).toHaveLength(2);
    });

    it('applies skip/take derived from page and limit', async () => {
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findAndCount as ReturnType<typeof vi.fn>).mockResolvedValue([
        [],
        0,
      ]);
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        createMockReservationRepository(),
        createMockDataSource(createMockManager()),
      );

      await service.findAll(false, 3, 10);

      expect(resourceRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the resource with its schedules regardless of isActive', async () => {
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseResource({
          isActive: false,
          schedules: [{ id: 'sched-9' } as ResourceSchedule],
        }),
      );
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        createMockReservationRepository(),
        createMockDataSource(createMockManager()),
      );

      const result = await service.findOne('resource-1');

      expect(result.isActive).toBe(false);
      expect(result.schedules).toHaveLength(1);
    });

    it('throws NotFoundException when the resource does not exist', async () => {
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        null,
      );
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        createMockReservationRepository(),
        createMockDataSource(createMockManager()),
      );

      await expect(service.findOne('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update — replace semantics', () => {
    it('touches only scalar fields and issues no delete/insert when schedules key is absent', async () => {
      const manager = createMockManager();
      const dataSource = createMockDataSource(manager);
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseResource(),
      );
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        createMockReservationRepository(),
        dataSource,
      );

      await service.update('resource-1', { name: 'Room B' });

      expect(manager.update).toHaveBeenCalledWith(
        Resource,
        'resource-1',
        expect.objectContaining({ name: 'Room B' }),
      );
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('performs a transactional delete-then-insert replace for a non-empty schedules array', async () => {
      const manager = createMockManager();
      const dataSource = createMockDataSource(manager);
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseResource(),
      );
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        createMockReservationRepository(),
        dataSource,
      );

      await service.update('resource-1', {
        schedules: [{ dayOfWeek: 2, openTime: '08:00', closeTime: '10:00' }],
      });

      expect(manager.delete).toHaveBeenCalledWith(ResourceSchedule, {
        resourceId: 'resource-1',
      });
      expect(manager.insert).toHaveBeenCalledWith(
        ResourceSchedule,
        expect.arrayContaining([
          expect.objectContaining({ resourceId: 'resource-1', dayOfWeek: 2 }),
        ]),
      );
    });

    it('clears all windows (delete only, no insert) for an explicit empty schedules array', async () => {
      const manager = createMockManager();
      const dataSource = createMockDataSource(manager);
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseResource(),
      );
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        createMockReservationRepository(),
        dataSource,
      );

      await service.update('resource-1', { schedules: [] });

      expect(manager.delete).toHaveBeenCalledWith(ResourceSchedule, {
        resourceId: 'resource-1',
      });
      expect(manager.insert).not.toHaveBeenCalled();
    });
  });

  describe('23P01 (EXCLUDE violation) mapping', () => {
    it('create() maps a 23P01 error to ConflictException', async () => {
      const dataSource = {
        transaction: vi.fn(async () => {
          throw { code: '23P01' };
        }),
      } as unknown as DataSource;
      const service = new ResourcesService(
        createMockResourceRepository(),
        createMockScheduleRepository(),
        createMockReservationRepository(),
        dataSource,
      );

      await expect(
        service.create({
          name: 'Room E',
          capacity: 2,
          minBookingMinutes: 30,
          maxBookingMinutes: 30,
          schedules: [{ dayOfWeek: 1, openTime: '09:00', closeTime: '12:00' }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('update() maps a 23P01 error to ConflictException', async () => {
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseResource(),
      );
      const dataSource = {
        transaction: vi.fn(async () => {
          throw { code: '23P01' };
        }),
      } as unknown as DataSource;
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        createMockReservationRepository(),
        dataSource,
      );

      await expect(
        service.update('resource-1', {
          schedules: [{ dayOfWeek: 1, openTime: '09:00', closeTime: '12:00' }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('deactivate', () => {
    it('writes only isActive: false via a single-column update', async () => {
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseResource({ isActive: false }),
      );
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        createMockReservationRepository(),
        createMockDataSource(createMockManager()),
      );

      const result = await service.deactivate('resource-1');

      expect(resourceRepository.update).toHaveBeenCalledWith('resource-1', {
        isActive: false,
      });
      expect(result.isActive).toBe(false);
    });

    it('throws NotFoundException when deactivating a resource that does not exist', async () => {
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        null,
      );
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        createMockReservationRepository(),
        createMockDataSource(createMockManager()),
      );

      await expect(service.deactivate('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('toResponse', () => {
    it('maps a resource with nested schedules to the response shape', () => {
      const service = new ResourcesService(
        createMockResourceRepository(),
        createMockScheduleRepository(),
        createMockReservationRepository(),
        createMockDataSource(createMockManager()),
      );
      const resource = baseResource({
        notes: 'Has a whiteboard',
        amenities: ['projector'],
        schedules: [
          {
            id: 'sched-1',
            resourceId: 'resource-1',
            dayOfWeek: 1,
            openTime: '09:00',
            closeTime: '12:00',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          } as ResourceSchedule,
        ],
      });

      const response = service.toResponse(resource);

      expect(response).toEqual({
        id: 'resource-1',
        name: 'Room A',
        capacity: 4,
        isActive: true,
        minBookingMinutes: 30,
        maxBookingMinutes: 60,
        notes: 'Has a whiteboard',
        amenities: ['projector'],
        schedules: [
          { id: 'sched-1', dayOfWeek: 1, openTime: '09:00', closeTime: '12:00' },
        ],
        createdAt: resource.createdAt,
        updatedAt: resource.updatedAt,
      });
    });

    it('maps an empty schedules array to an empty response array', () => {
      const service = new ResourcesService(
        createMockResourceRepository(),
        createMockScheduleRepository(),
        createMockReservationRepository(),
        createMockDataSource(createMockManager()),
      );
      const resource = baseResource({ schedules: [] });

      const response = service.toResponse(resource);

      expect(response.schedules).toEqual([]);
    });
  });

  describe('getAvailability', () => {
    it('throws NotFoundException when the resource does not exist', async () => {
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        null,
      );
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        createMockReservationRepository(),
        createMockDataSource(createMockManager()),
      );

      await expect(
        service.getAvailability(
          'missing-id',
          '2026-02-01T00:00:00.000Z',
          '2026-02-02T00:00:00.000Z',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when to is not after from', async () => {
      const service = new ResourcesService(
        createMockResourceRepository(),
        createMockScheduleRepository(),
        createMockReservationRepository(),
        createMockDataSource(createMockManager()),
      );

      await expect(
        service.getAvailability(
          'resource-1',
          '2026-02-10T00:00:00.000Z',
          '2026-02-09T00:00:00.000Z',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when the range exceeds MAX_AVAILABILITY_RANGE_DAYS', async () => {
      const service = new ResourcesService(
        createMockResourceRepository(),
        createMockScheduleRepository(),
        createMockReservationRepository(),
        createMockDataSource(createMockManager()),
      );

      await expect(
        service.getAvailability(
          'resource-1',
          '2026-01-01T00:00:00.000Z',
          '2026-06-01T00:00:00.000Z',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns an empty freeIntervals array for an inactive resource without querying reservations', async () => {
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseResource({ isActive: false }),
      );
      const reservationRepository = createMockReservationRepository();
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        reservationRepository,
        createMockDataSource(createMockManager()),
      );

      const result = await service.getAvailability(
        'resource-1',
        '2026-02-01T00:00:00.000Z',
        '2026-02-02T00:00:00.000Z',
      );

      expect(result.freeIntervals).toEqual([]);
      expect(reservationRepository.find).not.toHaveBeenCalled();
    });

    it('queries reservations filtered to CONFIRMED only, so cancelled reservations never reduce availability', async () => {
      const resourceRepository = createMockResourceRepository();
      (resourceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        baseResource({
          schedules: [
            {
              id: 'sched-1',
              resourceId: 'resource-1',
              dayOfWeek: 1,
              openTime: '09:00',
              closeTime: '17:00',
            } as ResourceSchedule,
          ],
        }),
      );
      const reservationRepository = createMockReservationRepository();
      const service = new ResourcesService(
        resourceRepository,
        createMockScheduleRepository(),
        reservationRepository,
        createMockDataSource(createMockManager()),
      );

      await service.getAvailability(
        'resource-1',
        '2026-02-01T00:00:00.000Z',
        '2026-02-02T00:00:00.000Z',
      );

      expect(reservationRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            resourceId: 'resource-1',
            status: ReservationStatus.CONFIRMED,
          }),
        }),
      );
    });
  });
});
