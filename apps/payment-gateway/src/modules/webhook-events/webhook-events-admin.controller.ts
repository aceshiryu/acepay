import {
  Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../auth/admin.guard';
import { ListWebhookEventsDto, WebhookStatsDto } from './dto/list-webhook-events.dto';
import { WebhookEventsAdminService } from './webhook-events-admin.service';

@ApiTags('admin/webhook-events')
@ApiBearerAuth('admin')
@UseGuards(AdminGuard)
@Controller('admin/webhook-events')
export class WebhookEventsAdminController {
  constructor(private readonly events: WebhookEventsAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List webhook events with filters + pagination + search' })
  list(@Query() q: ListWebhookEventsDto) {
    return this.events.list(q);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Delivered (window), pending, failed, exhausted, avg delivery latency (ms)',
  })
  stats(@Query() q: WebhookStatsDto) {
    return this.events.stats(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Webhook event detail (raw + normalized payloads, attempts, response)' })
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.findOne(id);
  }

  @Post(':id/retry')
  @ApiOperation({
    summary: 'Re-queue an event for delivery. Worker integration in slice 5.',
  })
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.retry(id);
  }
}
