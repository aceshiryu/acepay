import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../auth/api-key.guard';
import { AppRateLimitGuard } from '../../common/throttling/app-rate-limit.guard';
import { CurrentApp } from '../../auth/current-app.decorator';
import { App } from '../../database/entities';
import { CustomersAppService } from './customers-app.service';
import { CreateCustomerDto } from './dto/create-customer.dto';

@ApiTags('customers')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard, AppRateLimitGuard)
@Controller('v1/customers')
export class CustomersAppController {
  constructor(private readonly customers: CustomersAppService) {}

  @Post()
  @ApiOperation({
    summary: 'Register or upsert a customer (idempotent on externalId or email)',
  })
  upsert(@CurrentApp() app: App, @Body() dto: CreateCustomerDto) {
    return this.customers.upsert(app, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a customer (must belong to the calling app)' })
  one(@CurrentApp() app: App, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.findOne(app, id);
  }
}
