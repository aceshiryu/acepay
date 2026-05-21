import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../auth/admin.guard';
import { StatsService } from './stats.service';

@ApiTags('admin/stats')
@ApiBearerAuth('admin')
@UseGuards(AdminGuard)
@Controller('admin/stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Top-level dashboard metrics',
    description:
      'Returns transactions today, revenue today by currency, success rate, ' +
      'active subscriptions, this-week + this-month volume, failed-webhooks-pending, app counts.',
  })
  dashboard() {
    return this.stats.dashboard();
  }

  @Get('providers')
  @ApiOperation({ summary: 'Provider webhook ingestion health (ok / warn / bad per provider)' })
  providers() {
    return this.stats.providerStatus();
  }

  @Get('apps/:id')
  @ApiOperation({ summary: 'Per-app summary stats (tx count, revenue, active subs, success rate)' })
  app(@Param('id', ParseUUIDPipe) id: string) {
    return this.stats.appSummary(id);
  }
}
