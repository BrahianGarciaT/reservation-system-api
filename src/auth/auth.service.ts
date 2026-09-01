import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserRole } from '../users/user-role.enum.js';
import type { UserResponseDto } from '../users/dto/user-response.dto.js';
import { UsersService } from '../users/users.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { JwtPayload } from './types/jwt-payload.type.js';

const BCRYPT_SALT_ROUNDS = 10;
const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';
// Precomputed at module load so login() always runs a bcrypt.compare of
// comparable cost for an unknown email, avoiding a timing side-channel that
// would otherwise leak whether an account exists.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  'dummy-password-for-timing-safety',
  BCRYPT_SALT_ROUNDS,
);

export interface AuthResult {
  accessToken: string;
}

export interface RegisterResult extends AuthResult {
  user: UserResponseDto;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<RegisterResult> {
    const user = await this.usersService.create({
      email: dto.email,
      password: dto.password,
      role: UserRole.USER,
    });

    const accessToken = this.signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return { accessToken, user: this.usersService.toResponse(user) };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersService.findByEmail(dto.email);

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const accessToken = this.signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return { accessToken };
  }

  private signToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload);
  }
}
