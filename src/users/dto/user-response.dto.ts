import { UserRole } from '../user-role.enum.js';

export class UserResponseDto {
  id: string;
  email: string;
  role: UserRole;
  createdAt: Date;
}
