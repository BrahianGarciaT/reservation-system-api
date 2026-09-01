import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { JwtPayload } from '../auth/types/jwt-payload.type.js';
import { UserRole } from '../users/user-role.enum.js';
import { CreateResourceDto } from './dto/create-resource.dto.js';
import { ListResourcesQueryDto } from './dto/list-resources-query.dto.js';
import type { ResourceResponseDto } from './dto/resource-response.dto.js';
import { UpdateResourceDto } from './dto/update-resource.dto.js';
import { ResourcesService } from './resources.service.js';

@Controller('resources')
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Roles(UserRole.ADMIN)
  @Post()
  async create(@Body() dto: CreateResourceDto): Promise<ResourceResponseDto> {
    const resource = await this.resourcesService.create(dto);
    return this.resourcesService.toResponse(resource);
  }

  @Roles(UserRole.ADMIN, UserRole.USER)
  @Get()
  async findAll(
    @Query() query: ListResourcesQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ResourceResponseDto[]> {
    const includeInactive = query.includeInactive === true;

    if (includeInactive && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only admins may request includeInactive=true',
      );
    }

    const resources = await this.resourcesService.findAll(includeInactive);
    return resources.map((resource) => this.resourcesService.toResponse(resource));
  }

  @Roles(UserRole.ADMIN, UserRole.USER)
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ResourceResponseDto> {
    const resource = await this.resourcesService.findOne(id);
    return this.resourcesService.toResponse(resource);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateResourceDto,
  ): Promise<ResourceResponseDto> {
    const resource = await this.resourcesService.update(id, dto);
    return this.resourcesService.toResponse(resource);
  }

  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Patch(':id/deactivate')
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ResourceResponseDto> {
    const resource = await this.resourcesService.deactivate(id);
    return this.resourcesService.toResponse(resource);
  }
}
