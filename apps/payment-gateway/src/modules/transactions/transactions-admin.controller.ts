import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AdminGuard } from '../../auth/admin.guard';
import { ListTransactionsDto, RefundDto } from './dto/list-transactions.dto';
import { TransactionsAdminService } from './transactions-admin.service';

class ReconcileStaleDto {
  @ApiPropertyOptional({ default: 120, minimum: 30, maximum: 86400, description: 'Reconcile pending tx older than this many seconds' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(86400)
  staleAfterSeconds?: number = 120;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 500, description: 'Max number of tx to reconcile in one call' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;
}

@ApiTags('admin/transactions')
@ApiBearerAuth('admin')
@UseGuards(AdminGuard)
@Controller('admin/transactions')
export class TransactionsAdminController {
  constructor(private readonly txs: TransactionsAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List transactions with filters + pagination + free-text search' })
  list(@Query() q: ListTransactionsDto) {
    return this.txs.list(q);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Counts grouped by status (total / succeeded / pending / failed / refunded)',
    description: 'Accepts the same filters as the list endpoint.',
  })
  stats(@Query() q: ListTransactionsDto) {
    return this.txs.stats(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Transaction detail with logs, app, customer, subscription, webhook events' })
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.txs.findOne(id);
  }

  @Get(':id/logs')
  @ApiOperation({ summary: 'Movement log for a transaction (chronological)' })
  logs(@Param('id', ParseUUIDPipe) id: string) {
    return this.txs.logsFor(id);
  }

  @Post(':id/refund')
  @ApiOperation({
    summary: 'Issue a refund. Records a refund transaction. Provider call is wired in slice 4.',
  })
  refund(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundDto) {
    return this.txs.refund(id, dto);
  }

  @Post(':id/sync')
  @ApiOperation({
    summary: 'Reconcile a single transaction with the provider',
    description:
      'Pulls live state from Lemon Squeezy / Xendit, applies any status change, ' +
      'and re-delivers a normalized webhook to the owning app. Use when a transaction ' +
      'is stuck on `pending` because the provider webhook never reached us.',
  })
  syncOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.txs.sync(id);
  }

  @Post('reconcile-stale')
  @ApiOperation({
    summary: 'Batch-reconcile pending transactions older than a threshold',
    description:
      'Sweeps `pending` transactions older than `staleAfterSeconds`, hits the provider ' +
      'for each, applies state, and re-delivers any missed webhooks. Returns one result row per tx.',
  })
  reconcileStale(@Body() dto: ReconcileStaleDto) {
    return this.txs.reconcileStale(dto.staleAfterSeconds, dto.limit);
  }
}
