import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import type { JwtPayload } from '../auth/types/jwt-payload.type.js';
import { UserRole } from '../users/user-role.enum.js';
import type { Reservation } from './reservation.entity.js';
import { ReservationsController } from './reservations.controller.js';
import type { ReservationsService } from './reservations.service.js';

function createMockReservationsService(): ReservationsService {
  return {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    cancel: vi.fn(),
    reschedule: vi.fn(),
    toResponse: vi.fn((reservation: Reservation) => ({
      id: reservation.id,
      resourceId: reservation.resourceId,
    })),
  } as unknown as ReservationsService;
}

const ownerUser: JwtPayload = { sub: 'user-1', role: UserRole.USER };

const fakeReservation = {
  id: 'reservation-1',
  resourceId: 'resource-1',
} as Reservation;

const reflector = new Reflector();

function rolesFor(target: object, method: string): UserRole[] | undefined {
  return reflector.get<UserRole[]>(
    ROLES_KEY,
    (target as unknown as Record<string, (...args: unknown[]) => unknown>)[
      method
    ],
  );
}

describe('ReservationsController', () => {
  describe('@Roles metadata', () => {
    it('requires ADMIN or USER on every route', () => {
      const controller = new ReservationsController(
        createMockReservationsService(),
      );

      for (const method of [
        'create',
        'findAll',
        'findOne',
        'cancel',
        'reschedule',
      ]) {
        expect(rolesFor(controller, method)).toEqual([
          UserRole.ADMIN,
          UserRole.USER,
        ]);
      }
    });
  });

  describe('create', () => {
    it('delegates to service.create with the caller as owner, never reading owner from the body', async () => {
      const service = createMockReservationsService();
      (service.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        fakeReservation,
      );
      const controller = new ReservationsController(service);
      const dto = {
        resourceId: 'resource-1',
        startsAt: '2027-01-04T09:00:00.000Z',
        endsAt: '2027-01-04T10:00:00.000Z',
      };

      const result = await controller.create(dto, ownerUser);

      expect(service.create).toHaveBeenCalledWith(dto, ownerUser);
      expect(service.toResponse).toHaveBeenCalledWith(fakeReservation);
      expect(result).toEqual({ id: 'reservation-1', resourceId: 'resource-1' });
    });
  });

  describe('findAll', () => {
    it('delegates to service.findAll with the query and caller, mapping data through toResponse', async () => {
      const service = createMockReservationsService();
      (service.findAll as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: [fakeReservation],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
      const controller = new ReservationsController(service);
      const query = { resourceId: 'resource-1' };

      const result = await controller.findAll(query, ownerUser);

      expect(service.findAll).toHaveBeenCalledWith(query, ownerUser);
      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });
  });

  describe('findOne', () => {
    it('delegates to service.findOne with the id and caller', async () => {
      const service = createMockReservationsService();
      (service.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        fakeReservation,
      );
      const controller = new ReservationsController(service);

      const result = await controller.findOne('reservation-1', ownerUser);

      expect(service.findOne).toHaveBeenCalledWith('reservation-1', ownerUser);
      expect(result).toEqual({ id: 'reservation-1', resourceId: 'resource-1' });
    });

    it('propagates ForbiddenException (403) from the service for a foreign non-admin caller', async () => {
      const service = createMockReservationsService();
      (service.findOne as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ForbiddenException(),
      );
      const controller = new ReservationsController(service);

      await expect(
        controller.findOne('reservation-1', ownerUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('cancel', () => {
    it('delegates to service.cancel with the id and caller', async () => {
      const service = createMockReservationsService();
      (service.cancel as ReturnType<typeof vi.fn>).mockResolvedValue(
        fakeReservation,
      );
      const controller = new ReservationsController(service);

      const result = await controller.cancel('reservation-1', ownerUser);

      expect(service.cancel).toHaveBeenCalledWith('reservation-1', ownerUser);
      expect(result).toEqual({ id: 'reservation-1', resourceId: 'resource-1' });
    });

    it('propagates ForbiddenException (403) from the service for a foreign non-admin caller', async () => {
      const service = createMockReservationsService();
      (service.cancel as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ForbiddenException(),
      );
      const controller = new ReservationsController(service);

      await expect(
        controller.cancel('reservation-1', ownerUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('reschedule', () => {
    it('delegates to service.reschedule with the id, dto and caller', async () => {
      const service = createMockReservationsService();
      (service.reschedule as ReturnType<typeof vi.fn>).mockResolvedValue(
        fakeReservation,
      );
      const controller = new ReservationsController(service);
      const dto = {
        startsAt: '2027-01-04T10:30:00.000Z',
        endsAt: '2027-01-04T11:30:00.000Z',
      };

      const result = await controller.reschedule(
        'reservation-1',
        dto,
        ownerUser,
      );

      expect(service.reschedule).toHaveBeenCalledWith(
        'reservation-1',
        dto,
        ownerUser,
      );
      expect(result).toEqual({ id: 'reservation-1', resourceId: 'resource-1' });
    });

    it('propagates ForbiddenException (403) from the service for a foreign non-admin caller', async () => {
      const service = createMockReservationsService();
      (service.reschedule as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ForbiddenException(),
      );
      const controller = new ReservationsController(service);

      await expect(
        controller.reschedule(
          'reservation-1',
          { startsAt: '2027-01-04T10:30:00.000Z', endsAt: '2027-01-04T11:30:00.000Z' },
          ownerUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
