import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum.js';
import type { JwtPayload } from '../auth/types/jwt-payload.type.js';
import type { ResourcesService } from './resources.service.js';
import { ResourcesController } from './resources.controller.js';
import type { Resource } from './resource.entity.js';

function createMockResourcesService(): ResourcesService {
  return {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    deactivate: vi.fn(),
    toResponse: vi.fn((resource: Resource) => ({
      id: resource.id,
      name: resource.name,
    })),
  } as unknown as ResourcesService;
}

const adminUser: JwtPayload = { sub: 'admin-1', role: UserRole.ADMIN };
const regularUser: JwtPayload = { sub: 'user-1', role: UserRole.USER };

const fakeResource = { id: 'resource-1', name: 'Room A' } as Resource;

describe('ResourcesController', () => {
  describe('create', () => {
    it('delegates to service.create and returns the mapped response', async () => {
      const service = createMockResourcesService();
      (service.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        fakeResource,
      );
      const controller = new ResourcesController(service);
      const dto = {
        name: 'Room A',
        capacity: 4,
        minBookingMinutes: 30,
        maxBookingMinutes: 60,
      };

      const result = await controller.create(dto);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(service.toResponse).toHaveBeenCalledWith(fakeResource);
      expect(result).toEqual({ id: 'resource-1', name: 'Room A' });
    });
  });

  describe('findAll', () => {
    it('calls service.findAll(false) when includeInactive is not requested', async () => {
      const service = createMockResourcesService();
      (service.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([
        fakeResource,
      ]);
      const controller = new ResourcesController(service);

      const result = await controller.findAll({}, regularUser);

      expect(service.findAll).toHaveBeenCalledWith(false);
      expect(result).toHaveLength(1);
    });

    it('calls service.findAll(true) when an admin requests includeInactive', async () => {
      const service = createMockResourcesService();
      (service.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const controller = new ResourcesController(service);

      await controller.findAll({ includeInactive: true }, adminUser);

      expect(service.findAll).toHaveBeenCalledWith(true);
    });

    it('throws ForbiddenException when a non-admin requests includeInactive=true', async () => {
      const service = createMockResourcesService();
      const controller = new ResourcesController(service);

      await expect(
        controller.findAll({ includeInactive: true }, regularUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.findAll).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('delegates to service.findOne and returns the mapped response', async () => {
      const service = createMockResourcesService();
      (service.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        fakeResource,
      );
      const controller = new ResourcesController(service);

      const result = await controller.findOne('resource-1');

      expect(service.findOne).toHaveBeenCalledWith('resource-1');
      expect(result).toEqual({ id: 'resource-1', name: 'Room A' });
    });
  });

  describe('update', () => {
    it('delegates to service.update and returns the mapped response', async () => {
      const service = createMockResourcesService();
      (service.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        fakeResource,
      );
      const controller = new ResourcesController(service);
      const dto = { name: 'Room B' };

      const result = await controller.update('resource-1', dto);

      expect(service.update).toHaveBeenCalledWith('resource-1', dto);
      expect(result).toEqual({ id: 'resource-1', name: 'Room A' });
    });
  });

  describe('deactivate', () => {
    it('delegates to service.deactivate and returns the mapped response', async () => {
      const service = createMockResourcesService();
      (service.deactivate as ReturnType<typeof vi.fn>).mockResolvedValue(
        fakeResource,
      );
      const controller = new ResourcesController(service);

      const result = await controller.deactivate('resource-1');

      expect(service.deactivate).toHaveBeenCalledWith('resource-1');
      expect(result).toEqual({ id: 'resource-1', name: 'Room A' });
    });
  });
});
