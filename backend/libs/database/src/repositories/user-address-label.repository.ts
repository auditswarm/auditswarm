import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { UserAddressLabel } from '@prisma/client';

@Injectable()
export class UserAddressLabelRepository {
  constructor(private prisma: PrismaService) {}

  async findByUserAndAddress(userId: string, address: string): Promise<UserAddressLabel | null> {
    return this.prisma.userAddressLabel.findUnique({
      where: { userId_address: { userId, address } },
    });
  }

  async findByUserId(userId: string): Promise<UserAddressLabel[]> {
    return this.prisma.userAddressLabel.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upsert(
    userId: string,
    address: string,
    data: { label: string; entityType?: string; notes?: string },
  ): Promise<UserAddressLabel> {
    return this.prisma.userAddressLabel.upsert({
      where: { userId_address: { userId, address } },
      create: { userId, address, ...data },
      update: data,
    });
  }

  async delete(id: string): Promise<UserAddressLabel> {
    return this.prisma.userAddressLabel.delete({ where: { id } });
  }

  async findById(id: string): Promise<UserAddressLabel | null> {
    return this.prisma.userAddressLabel.findUnique({ where: { id } });
  }
}
