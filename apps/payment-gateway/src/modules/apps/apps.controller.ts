import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../auth/admin.guard';
import { BillingMode, Provider } from '../../common/enums';
import { App, User } from '../../database/entities';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AppPreferences, AppPreferencesService } from './app-preferences.service';
import { AppStatusService } from './app-status.service';
import { UpdateAppMenusDto } from './dto/update-app-menus.dto';
import { TestPaymentDto } from './dto/test-payment.dto';
import { OneTimePaymentsService } from '../payments/one-time-payments.service';
import { randomUUID } from 'crypto';
import { AppsService } from './apps.service';
import { WebhookPingService } from './webhook-ping.service';
import { CreateAppDto } from './dto/create-app.dto';
import { RegenerateKeyDto } from './dto/regenerate-key.dto';
import { TestSubscriptionDto } from './dto/test-subscription.dto';
import { UpdateAppDto } from './dto/update-app.dto';

interface AppView {
  id: string;
  code: string;
  name: string;
  slug: string;
  apiKeyPrefix: string;
  webhookUrl: string | null;
  requiredMetadata: string[];
  optionalMetadata: string[];
  rateLimit: number;
  isActive: boolean;
  /** Set = archived (hidden from lists, key rejected). */
  archivedAt: Date | null;
  /** Xendit codes; null = every method. */
  paymentMethods: string[] | null;
  lastPing: { at: Date; ok: boolean | null; detail: string | null } | null;
  /** Derived from the app's plans (else its transactions). Usually one. */
  providers: Provider[];
  billingMode: BillingMode;
  apiKeyExpiresAt: Date | null;
  marketplaceEnabled: boolean;
  marketplaceFeePercent: number | null;
  /** Inner-sidebar items the operator hid for this app (admin only). */
  hiddenMenus: string[];
  createdAt: Date;
  updatedAt: Date;
}

function toView(app: App, providers: Provider[] = [], prefs?: AppPreferences): AppView {
  return {
    id: app.id,
    code: app.code,
    name: app.name,
    slug: app.slug,
    apiKeyPrefix: app.apiKeyPrefix,
    webhookUrl: app.webhookUrl ?? null,
    requiredMetadata: app.requiredMetadata,
    optionalMetadata: app.optionalMetadata,
    rateLimit: app.rateLimit,
    isActive: app.isActive,
    archivedAt: app.archivedAt ?? null,
    paymentMethods: app.paymentMethods ?? null,
    lastPing: app.lastPingAt ? { at: app.lastPingAt, ok: app.lastPingOk ?? null, detail: app.lastPingDetail ?? null } : null,
    providers,
    billingMode: app.billingMode,
    apiKeyExpiresAt: app.apiKeyExpiresAt ?? null,
    marketplaceEnabled: app.marketplaceEnabled,
    marketplaceFeePercent: app.marketplaceFeePercent == null ? null : Number(app.marketplaceFeePercent),
    hiddenMenus: prefs?.hiddenMenus ?? [],
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}

@ApiTags('admin/apps')
@ApiBearerAuth('admin')
@Controller('admin/apps')
@UseGuards(AdminGuard)
export class AppsController {
  constructor(
    private readonly apps: AppsService,
    private readonly ping: WebhookPingService,
    private readonly status: AppStatusService,
    private readonly prefs: AppPreferencesService,
    private readonly oneTime: OneTimePaymentsService,
  ) {}

  private async view(app: App): Promise<AppView> {
    const [providers, prefs] = await Promise.all([this.status.providersFor([app.id]), this.prefs.get(app.id)]);
    return toView(app, providers.get(app.id), prefs);
  }

  @Post()
  @ApiOperation({ summary: 'Register a new app and generate its API key + webhook secret' })
  async register(@Body() dto: CreateAppDto) {
    const result = await this.apps.create(dto);
    return {
      app: await this.view(result.app),
      apiKey: result.apiKey,
      webhookSecret: result.webhookSecret,
      warning: 'Store the apiKey and webhookSecret now — they will not be shown again.',
    };
  }

  @Get()
  @ApiOperation({ summary: 'List registered apps. Archived apps are left out unless ?archived=true, which lists only them.' })
  @ApiQuery({ name: 'archived', required: false, type: Boolean })
  async list(@Query('archived') archived?: string) {
    const apps = await this.apps.findAll({ archived: archived === 'true' });
    const ids = apps.map((a) => a.id);
    const [providers, prefs] = await Promise.all([this.status.providersFor(ids), this.prefs.getMany(ids)]);
    return { data: apps.map((a) => toView(a, providers.get(a.id), prefs.get(a.id))) };
  }

  @Get('statuses')
  @ApiOperation({ summary: 'Health status of every app (Live / Needs attention / Not ready / Inactive), for the sidebar' })
  async statuses() {
    const apps = await this.apps.findAll();
    const now = new Date();
    const rows = await Promise.all(apps.map(async (a) => ({ appId: a.id, ...(await this.status.statusFor(a, now)) })));
    return { data: rows.map(({ appId, status }) => ({ appId, status })) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one app by id' })
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.view(await this.apps.findOneOrFail(id));
  }

  @Put(':id/menus')
  @ApiOperation({ summary: "Choose which of the app's admin menu items to hide (Overview and App settings always show)" })
  async setMenus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppMenusDto,
    @CurrentUser() user: User,
  ) {
    const app = await this.apps.findOneOrFail(id);
    await this.prefs.set(app.id, { hiddenMenus: dto.hiddenMenus }, user.email);
    return this.view(app);
  }

  @Get(':id/status')
  @ApiOperation({ summary: "The app's health status plus the checklist that explains it" })
  async getStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.status.statusFor(await this.apps.findOneOrFail(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an app (name, webhook URL, metadata schema, rate limit)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppDto,
  ) {
    return this.view(await this.apps.update(id, dto));
  }

  @Post(':id/regenerate-key')
  @ApiOperation({
    summary: 'Rotate the API key. The previous key is rejected immediately unless '
      + 'graceHours is given, which keeps it valid for that long so a running app '
      + 'does not break mid-rotation. Use the default (immediate) when rotating '
      + 'because a key may have leaked.',
  })
  async regenerateKey(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegenerateKeyDto = {},
  ) {
    const result = await this.apps.regenerateApiKey(id, dto.graceHours ?? 0);
    return {
      app: await this.view(result.app),
      apiKey: result.apiKey,
      previousKeyValidUntil: result.previousKeyValidUntil,
      warning: result.previousKeyValidUntil
        ? `Store this new key. The previous key stays valid until ${result.previousKeyValidUntil.toISOString()}.`
        : 'The previous API key is now invalid. Store this new key.',
    };
  }

  @Post(':id/regenerate-webhook-secret')
  @ApiOperation({ summary: 'Rotate the outbound webhook signing secret' })
  async regenerateWebhookSecret(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.apps.regenerateWebhookSecret(id);
    return {
      app: await this.view(result.app),
      webhookSecret: result.webhookSecret,
      warning: 'Update your verifier with this secret — the previous one is now invalid.',
    };
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate an app (rejects new requests with 403 app_inactive). It stays in the lists.' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.view(await this.apps.setActive(id, false));
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Archive an app: hidden from every admin list, API key rejected, history kept. Reversible.' })
  async archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.view(await this.apps.archive(id));
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Un-archive an app. It comes back deactivated; activate it separately.' })
  async restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.view(await this.apps.restore(id));
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Permanently delete an ARCHIVED app and all its data. Requires confirmName = the app name. ' +
      'Refused while it has live subscriptions or payouts in flight. Cannot be undone.',
  })
  @ApiBody({ schema: { example: { confirmName: 'BooklyPH' } } })
  deletePermanently(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { confirmName?: string } | undefined,
    @CurrentUser() user: User,
  ) {
    return this.apps.deletePermanently(id, body?.confirmName, user?.email ?? null);
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Reactivate a deactivated app' })
  async activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.view(await this.apps.setActive(id, true));
  }

  @Post(':id/webhook-test')
  @ApiOperation({ summary: "Send a signed app.ping to the app's webhook URL now, and report what it answered" })
  webhookTest(@Param('id', ParseUUIDPipe) id: string) {
    return this.ping.pingById(id);
  }

  @Post(':id/test-payment')
  @ApiOperation({
    summary: 'Create a one-time test payment for a non-marketplace app (PayMongo) and return its checkout URL. '
      + 'Tagged metadata.sandbox=true.',
  })
  async testPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TestPaymentDto,
  ) {
    const app = await this.apps.findOneOrFail(id);
    return this.oneTime.create(app, {
      amount: dto.amount,
      currency: 'PHP',
      idempotencyKey: `admin-test-${randomUUID()}`,
      description: dto.description ?? 'AcePay test payment',
      redirect: { success: dto.redirect, failed: dto.redirect },
      customer: dto.customerEmail ? { email: dto.customerEmail } : undefined,
      metadata: { sandbox: true },
    });
  }

  @Post(':id/test-subscription')
  @ApiOperation({ summary: 'Create a sandbox subscription using a test customer. Tagged metadata.sandbox=true.' })
  async testSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TestSubscriptionDto,
  ) {
    return this.apps.runSandboxSubscription(id, dto);
  }
}
