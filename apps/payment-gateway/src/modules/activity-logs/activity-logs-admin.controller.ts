import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../auth/admin.guard';
import { ActivityLogsAdminService } from './activity-logs-admin.service';
import { ListActivityLogsDto } from './dto/list-activity-logs.dto';

@ApiTags('admin/logs')
@ApiBearerAuth('admin')
@UseGuards(AdminGuard)
@Controller('admin/logs')
export class ActivityLogsAdminController {
  constructor(private readonly logs: ActivityLogsAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'System-wide activity feed (transaction movement log)',
    description: 'Filter by app, transaction, actor, action prefix, date range; full-text search on action / provider event id / tx id. Paginated, default 50/page.',
  })
  list(@Query() q: ListActivityLogsDto) {
    return this.logs.list(q);
  }
}
