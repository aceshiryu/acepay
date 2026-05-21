import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../auth/admin.guard';
import { App } from '../../database/entities';
import { AppsService } from './apps.service';
import { CreateAppDto } from './dto/create-app.dto';
import { TestSubscriptionDto } from './dto/test-subscription.dto';
import { UpdateAppDto } from './dto/update-app.dto';

interface AppView {
  id: string;
  name: string;
  slug: string;
  apiKeyPrefix: string;
  webhookUrl: string | null;
  requiredMetadata: string[];
  optionalMetadata: string[];
  rateLimit: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toView(app: App): AppView {
  return {
    id: app.id,
    name: app.name,
    slug: app.slug,
    apiKeyPrefix: app.apiKeyPrefix,
    webhookUrl: app.webhookUrl ?? null,
    requiredMetadata: app.requiredMetadata,
    optionalMetadata: app.optionalMetadata,
    rateLimit: app.rateLimit,
    isActive: app.isActive,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}

@ApiTags('admin/apps')
@ApiBearerAuth('admin')
@Controller('admin/apps')
@UseGuards(AdminGuard)
export class AppsController {
  constructor(private readonly apps: AppsService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new app and generate its API key + webhook secret' })
  async register(@Body() dto: CreateAppDto) {
    const result = await this.apps.create(dto);
    return {
      app: toView(result.app),
      apiKey: result.apiKey,
      webhookSecret: result.webhookSecret,
      warning: 'Store the apiKey and webhookSecret now — they will not be shown again.',
    };
  }

  @Get()
  @ApiOperation({ summary: 'List all registered apps' })
  async list() {
    const apps = await this.apps.findAll();
    return { data: apps.map(toView) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one app by id' })
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    return toView(await this.apps.findOneOrFail(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an app (name, webhook URL, metadata schema, rate limit)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppDto,
  ) {
    return toView(await this.apps.update(id, dto));
  }

  @Post(':id/regenerate-key')
  @ApiOperation({ summary: 'Rotate the API key. Previous key is rejected immediately.' })
  async regenerateKey(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.apps.regenerateApiKey(id);
    return {
      app: toView(result.app),
      apiKey: result.apiKey,
      warning: 'The previous API key is now invalid. Store this new key.',
    };
  }

  @Post(':id/regenerate-webhook-secret')
  @ApiOperation({ summary: 'Rotate the outbound webhook signing secret' })
  async regenerateWebhookSecret(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.apps.regenerateWebhookSecret(id);
    return {
      app: toView(result.app),
      webhookSecret: result.webhookSecret,
      warning: 'Update your verifier with this secret — the previous one is now invalid.',
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate an app (rejects new requests with 403 app_inactive)' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return toView(await this.apps.setActive(id, false));
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Reactivate a deactivated app' })
  async activate(@Param('id', ParseUUIDPipe) id: string) {
    return toView(await this.apps.setActive(id, true));
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
