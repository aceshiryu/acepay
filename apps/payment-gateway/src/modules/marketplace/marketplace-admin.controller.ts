import {
  Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../auth/admin.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { User } from '../../database/entities';
import {
  ChannelsQueryDto, ListMerchantsAdminDto, MarketplaceSettingsDto, UpdateMerchantAdminDto,
} from './dto/merchant.dto';
import {
  ConfirmPayoutRunDto, CreatePayoutRunDto, ListPayoutRunsDto, ListPayoutsDto,
} from './dto/payout-run.dto';
import { MarketplaceAdminService } from './marketplace-admin.service';
import { MerchantsService } from './merchants.service';
import { PayoutRunsService } from './payout-runs.service';

@ApiTags('admin/marketplace')
@ApiBearerAuth('admin')
@UseGuards(AdminGuard)
@Controller('admin')
export class MarketplaceAdminController {
  constructor(
    private readonly admin: MarketplaceAdminService,
    private readonly merchants: MerchantsService,
    private readonly runs: PayoutRunsService,
  ) {}

  // ── Settings + reporting ───────────────────────────────────────────

  @Get('marketplace/settings')
  @ApiOperation({ summary: 'Marketplace settings for every app' })
  settings() {
    return this.admin.listSettings();
  }

  @Put('apps/:id/marketplace')
  @ApiOperation({ summary: "Enable/disable marketplace payments for an app and set its fee + minimum payout" })
  updateSettings(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarketplaceSettingsDto) {
    return this.admin.updateSettings(id, dto);
  }

  @Get('marketplace/summary')
  @ApiOperation({ summary: 'Per app: merchants, platform fees earned, paid out' })
  summary() {
    return this.admin.summary();
  }

  @Get('marketplace/channels')
  @ApiOperation({ summary: 'Xendit payout channels (GCash, Maya, banks…) for a currency' })
  channels(@Query() q: ChannelsQueryDto) {
    return this.admin.listChannels(q.currency ?? 'PHP');
  }

  // ── Merchants ──────────────────────────────────────────────────────

  @Get('merchants')
  @ApiOperation({ summary: 'Search merchants across apps' })
  listMerchants(@Query() q: ListMerchantsAdminDto) {
    return this.merchants.adminList(q);
  }

  @Get('merchants/:id')
  @ApiOperation({ summary: 'Merchant detail, incl. other merchants paid to the same account' })
  merchant(@Param('id', ParseUUIDPipe) id: string) {
    return this.merchants.adminFindOne(id);
  }

  @Patch('merchants/:id')
  @ApiOperation({ summary: 'Pause/resume, set a fee override (e.g. 10% founding rate until a date), fix details' })
  updateMerchant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMerchantAdminDto) {
    return this.merchants.adminUpdate(id, dto);
  }

  @Get('merchants/:id/balance')
  @ApiOperation({ summary: 'Live sub-account balance' })
  merchantBalance(@Param('id', ParseUUIDPipe) id: string) {
    return this.merchants.adminBalance(id);
  }

  @Get('merchants/:id/payouts')
  @ApiOperation({ summary: 'Merchant payout history' })
  merchantPayouts(@Param('id', ParseUUIDPipe) id: string, @Query() q: ListPayoutsDto) {
    return this.merchants.adminPayouts(id, q);
  }

  @Post('merchants/:id/sync')
  @ApiOperation({ summary: 'Re-check the Xendit sub-account (or create it if creation failed)' })
  syncMerchant(@Param('id', ParseUUIDPipe) id: string) {
    return this.merchants.syncAccount(id);
  }

  // ── Payout runs (manual, one click) ────────────────────────────────

  @Post('payout-runs')
  @ApiOperation({
    summary: 'Start a payout run',
    description: 'Reads every merchant’s live balance in the background and builds a preview. Nothing is sent until confirm.',
  })
  createRun(@Body() dto: CreatePayoutRunDto, @CurrentUser() user: User) {
    return this.runs.create(dto, user.email);
  }

  @Get('payout-runs')
  @ApiOperation({ summary: 'Payout run history' })
  listRuns(@Query() q: ListPayoutRunsDto) {
    return this.runs.list(q);
  }

  @Get('payout-runs/:id')
  @ApiOperation({ summary: 'Run detail: payouts, excluded merchants and why, totals' })
  run(@Param('id', ParseUUIDPipe) id: string) {
    return this.runs.detail(id);
  }

  @Post('payout-runs/:id/confirm')
  @ApiOperation({ summary: 'Confirm the preview (optionally skipping merchants) and send' })
  confirmRun(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmPayoutRunDto, @CurrentUser() user: User) {
    return this.runs.confirm(id, dto, user.email);
  }

  @Post('payout-runs/:id/discard')
  @ApiOperation({ summary: 'Throw away a draft without sending anything' })
  discardRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.runs.discard(id);
  }

  @Post('payout-runs/:id/retry-failed')
  @ApiOperation({ summary: 'Re-send failed payouts using each merchant’s current payout details' })
  retryRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.runs.retryFailed(id);
  }

  @Get('payout-runs/:id/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'CSV of every payout in the run' })
  exportRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.runs.exportCsv(id);
  }

  @Post('payouts/:id/sync')
  @ApiOperation({ summary: 'Pull one payout’s status from Xendit (for a missed webhook)' })
  syncPayout(@Param('id', ParseUUIDPipe) id: string) {
    return this.runs.syncPayout(id);
  }
}
