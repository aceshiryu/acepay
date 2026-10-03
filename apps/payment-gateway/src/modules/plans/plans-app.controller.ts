import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../auth/api-key.guard';
import { AppRateLimitGuard } from '../../common/throttling/app-rate-limit.guard';
import { CurrentApp } from '../../auth/current-app.decorator';
import { App } from '../../database/entities';
import { ListPlansDto } from './dto/list-plans.dto';
import { PlansService } from './plans.service';

@ApiTags('plans')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard, AppRateLimitGuard)
@Controller('v1/plans')
export class PlansAppController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @ApiOperation({ summary: 'List active plans available to the calling app' })
  list(@CurrentApp() app: App, @Query() q: ListPlansDto) {
    // Force isActive: an app must never be offered a plan it cannot subscribe
    // to. This shares PlansService.list with the admin, which only filters when
    // asked — correct for an operator, wrong for an app, so pin it here. The
    // override is last so a caller cannot ask for inactive plans.
    return this.plans.list({ ...q, appId: app.id, isActive: true });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one plan (must belong to the calling app)' })
  one(@CurrentApp() app: App, @Param('id', ParseUUIDPipe) id: string) {
    return this.plans.findOne(id, app.id);
  }
}
