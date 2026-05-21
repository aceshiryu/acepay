import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../auth/admin.guard';
import { CustomersAdminService } from './customers-admin.service';
import { ListCustomersDto } from './dto/list-customers.dto';

@ApiTags('admin/customers')
@ApiBearerAuth('admin')
@UseGuards(AdminGuard)
@Controller('admin/customers')
export class CustomersAdminController {
  constructor(private readonly customers: CustomersAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List customers with active-subs and tx counts' })
  list(@Query() q: ListCustomersDto) {
    return this.customers.list(q);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Total customers, with-subscriptions count, joined-this-month, top app' })
  stats() {
    return this.customers.stats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Customer detail with subscription + transaction history' })
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.findOne(id);
  }
}
