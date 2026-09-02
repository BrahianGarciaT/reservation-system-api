import {
  Body,
  Controller,
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
import { CreateReservationDto } from './dto/create-reservation.dto.js';
import { FindReservationsQueryDto } from './dto/find-reservations-query.dto.js';
import { RescheduleReservationDto } from './dto/reschedule-reservation.dto.js';
import type { ReservationResponseDto } from './dto/reservation-response.dto.js';
import { ReservationsService } from './reservations.service.js';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Roles(UserRole.ADMIN, UserRole.USER)
  @Post()
  async create(
    @Body() dto: CreateReservationDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ReservationResponseDto> {
    const reservation = await this.reservationsService.create(dto, user);
    return this.reservationsService.toResponse(reservation);
  }

  @Roles(UserRole.ADMIN, UserRole.USER)
  @Get()
  async findAll(
    @Query() query: FindReservationsQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ReservationResponseDto[]> {
    const reservations = await this.reservationsService.findAll(query, user);
    return reservations.map((reservation) =>
      this.reservationsService.toResponse(reservation),
    );
  }

  @Roles(UserRole.ADMIN, UserRole.USER)
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<ReservationResponseDto> {
    const reservation = await this.reservationsService.findOne(id, user);
    return this.reservationsService.toResponse(reservation);
  }

  @Roles(UserRole.ADMIN, UserRole.USER)
  @HttpCode(HttpStatus.OK)
  @Patch(':id/cancel')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<ReservationResponseDto> {
    const reservation = await this.reservationsService.cancel(id, user);
    return this.reservationsService.toResponse(reservation);
  }

  @Roles(UserRole.ADMIN, UserRole.USER)
  @HttpCode(HttpStatus.OK)
  @Patch(':id/reschedule')
  async reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleReservationDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ReservationResponseDto> {
    const reservation = await this.reservationsService.reschedule(
      id,
      dto,
      user,
    );
    return this.reservationsService.toResponse(reservation);
  }
}
