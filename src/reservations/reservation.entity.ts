import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Resource } from '../resources/resource.entity.js';
import { User } from '../users/user.entity.js';
import { ReservationStatus } from './reservation-status.enum.js';

@Entity('reservations')
export class Reservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'resource_id', type: 'uuid' })
  resourceId: string;

  @ManyToOne(() => Resource, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'resource_id' })
  resource: Relation<Resource>;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  // NOT NULL is load-bearing: the partial EXCLUDE constraint's predicate is
  // `WHERE (status <> 'cancelled')`, and `NULL <> 'cancelled'` evaluates to
  // NULL (not true), which Postgres treats as "exclude from the index" —
  // a nullable status column would silently lose all overlap protection.
  @Column({
    type: 'enum',
    enum: ReservationStatus,
    enumName: 'reservations_status_enum',
    default: ReservationStatus.CONFIRMED,
  })
  status: ReservationStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
