import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { User, Prisma } from '@prisma/client';

@Injectable()
export class UserRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByWalletAddress(address: string): Promise<User | null> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { address },
      include: { user: true },
    });
    return wallet?.user ?? null;
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  async updateLastLogin(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  async delete(id: string): Promise<User> {
    return this.prisma.user.delete({ where: { id } });
  }

  async findWithWallets(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { wallets: true },
    });
  }
}
