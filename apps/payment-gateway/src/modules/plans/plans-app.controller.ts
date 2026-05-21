import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../auth/api-key.guard';
import { CurrentApp } from '../../auth/current-app.decorator';
import { App } from '../../database/entities';
import { ListPlansDto } from './dto/list-plans.dto';
import { PlansService } from './plans.service';

@ApiTags('plans')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('v1/plans')
export class PlansAppController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @ApiOperation({ summary: 'List plans available to the calling app' })
  list(@CurrentApp() app: App, @Query() q: ListPlansDto) {
    return this.plans.list({ ...q, appId: app.id });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one plan (must belong to the calling app)' })
  one(@CurrentApp() app: App, @Param('id', ParseUUIDPipe) id: string) {
    return this.plans.findOne(id, app.id);
  }
}
