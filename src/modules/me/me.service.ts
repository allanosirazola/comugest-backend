import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma';
import { hashPassword } from '../../utils/password';
import { ValidationError } from '../../utils/errors';
import type { UpdateProfileInput, ChangePasswordInput } from './me.schemas';

const PROFILE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  locale: true,
  createdAt: true,
} as const;

export async function getProfile(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: PROFILE_SELECT,
  });
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone ?? null,
      ...(input.locale !== undefined && { locale: input.locale }),
    },
    select: PROFILE_SELECT,
  });
}

export async function changePassword(userId: string, input: ChangePasswordInput) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const matches = await bcrypt.compare(input.currentPassword, user.passwordHash ?? '');
  if (!matches) throw new ValidationError('La contraseña actual no es correcta');

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}
