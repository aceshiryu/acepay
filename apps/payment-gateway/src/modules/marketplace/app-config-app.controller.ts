import { Body, Controller, Get, Headers, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../auth/api-key.guard';
import { CurrentApp } from '../../auth/current-app.decorator';
import { apiKeyPrefix } from '../../common/crypto';
import { AppRateLimitGuard } from '../../common/throttling/app-rate-limit.guard';
import { App } from '../../database/entities';
import { AppConfigService } from './app-config.service';
import { UpdateAppConfigDto } from './dto/merchant.dto';

/** Lets an app read and adjust its own marketplace settings with its API key. */
@ApiTags('app config')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard, AppRateLimitGuard)
@Controller('v1/app/config')
export class AppConfigAppController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  @ApiOperation({ summary: "Your app's marketplace settings, including the fee range you're allowed to choose from" })
  get(@CurrentApp() app: App) {
    return this.config.view(app);
  }

  @Patch()
  @ApiOperation({
    summary: 'Change your default platform fee and/or minimum payout',
    description:
      'The fee must be inside the range the AcePay operator allowed (see `marketplace.feeBounds`); with no range ' +
      'set, only the operator can change it. A new fee applies to payments created after the change — existing ' +
      "payments keep the fee they were charged at. Coaches' individual fee overrides still win while they run. " +
      'Every change is logged and visible to the operator.',
  })
  update(
    @CurrentApp() app: App,
    @Body() dto: UpdateAppConfigDto,
    @Headers('x-api-key') key: string | undefined,
  ) {
    // Record which key made the change by its prefix — never the key itself.
    return this.config.updateFromApp(app, dto, key ? apiKeyPrefix(key) : null);
  }
}
