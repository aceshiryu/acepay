import {
  Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../auth/admin.guard';
import { ListSubscriptionsDto } from './dto/list-subscriptions.dto';
import { SubscriptionsAdminService } from './subscriptions-admin.service';

@ApiTags('admin/subscriptions')
@ApiBearerAuth('admin')
@UseGuards(AdminGuard)
@Controller('admin/subscriptions')
export class SubscriptionsAdminController {
  constructor(private readonly subs: SubscriptionsAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List subscriptions with filters + pagination' })
  list(@Query() q: ListSubscriptionsDto) {
    return this.subs.list(q);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Counts grouped by status + MRR estimate per currency',
    description: 'MRR is computed as the monthly-equivalent of active subs by interval × interval_count.',
  })
  stats(@Query() q: ListSubscriptionsDto) {
    return this.subs.stats(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Subscription detail with plan, customer, app, payment history' })
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.subs.findOne(id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Operator-initiated cancel (calls provider)' })
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.subs.cancel(id);
  }

  @Post(':id/pause')
  @ApiOperation({ summary: 'Operator-initiated pause (calls provider)' })
  pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.subs.pause(id);
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Operator-initiated resume (calls provider)' })
  resume(@Param('id', ParseUUIDPipe) id: string) {
    return this.subs.resume(id);
  }
}
