import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../auth/admin.guard';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('admin/notifications')
@ApiBearerAuth('admin')
@UseGuards(AdminGuard)
@Controller('admin/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List system notifications',
    description:
      'Synthesized from webhook_events (failed/exhausted = needs admin attention) ' +
      'and transaction_logs (payment failures, refunds). Read-state is tracked client-side.',
  })
  list(@Query() q: ListNotificationsDto) {
    return this.notifications.list(q);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Total notifications + counts grouped by severity' })
  stats() {
    return this.notifications.stats();
  }
}
