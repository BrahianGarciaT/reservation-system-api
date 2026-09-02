import { UserResponseDto } from '../../users/dto/user-response.dto.js';
import { AuthResponseDto } from './auth-response.dto.js';

export class RegisterResponseDto extends AuthResponseDto {
  user: UserResponseDto;
}
