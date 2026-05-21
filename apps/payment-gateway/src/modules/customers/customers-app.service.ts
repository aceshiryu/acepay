import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { App, Customer } from '../../database/entities';
import { CreateCustomerDto } from './dto/create-customer.dto';

@Injectable()
export class CustomersAppService {
  constructor(
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
  ) {}

  async upsert(app: App, dto: CreateCustomerDto): Promise<Customer> {
    const existing = await this.customers.findOne({
      where: [
        { appId: app.id, externalId: dto.externalId },
        { appId: app.id, email: dto.email.toLowerCase() },
      ],
    });
    if (existing) {
      existing.email = dto.email.toLowerCase();
      existing.externalId = dto.externalId;
      if (dto.name !== undefined) existing.name = dto.name;
      if (dto.metadata) existing.metadata = { ...existing.metadata, ...dto.metadata };
      return this.customers.save(existing);
    }
    const created = this.customers.create({
      appId: app.id,
      externalId: dto.externalId,
      email: dto.email.toLowerCase(),
      name: dto.name ?? null,
      metadata: dto.metadata ?? {},
    });
    return this.customers.save(created);
  }

  async findOne(app: App, id: string): Promise<Customer> {
    const c = await this.customers.findOne({ where: { id, appId: app.id } });
    if (!c) {
      throw new NotFoundException({ error: 'customer_not_found', message: `Customer ${id} not found` });
    }
    return c;
  }
}
