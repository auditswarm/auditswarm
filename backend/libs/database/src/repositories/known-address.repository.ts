import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { KnownAddress, Prisma } from '@prisma/client';

@Injectable()
export class KnownAddressRepository {
  constructor(private prisma: PrismaService) {}

  async findByAddress(address: string): Promise<KnownAddress | null> {
    return this.prisma.knownAddress.findUnique({ where: { address } });
  }

  async findByEntityType(entityType: string): Promise<KnownAddress[]> {
    return this.prisma.knownAddress.findMany({ where: { entityType } });
  }

  async upsert(
    address: string,
    data: Omit<Prisma.KnownAddressCreateInput, 'address'>,
  ): Promise<KnownAddress> {
    return this.prisma.knownAddress.upsert({
      where: { address },
      create: { address, ...data },
      update: data,
    });
  }

  async findAll(): Promise<KnownAddress[]> {
    return this.prisma.knownAddress.findMany({ orderBy: { name: 'asc' } });
  }
}
