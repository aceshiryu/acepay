import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../auth/admin.guard';
import { CreatePlanDto } from './dto/create-plan.dto';
import { ListPlansDto } from './dto/list-plans.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlansService } from './plans.service';

@ApiTags('admin/plans')
@ApiBearerAuth('admin')
@UseGuards(AdminGuard)
@Controller('admin/plans')
export class PlansAdminController {
  constructor(private readonly plans: PlansService) {}

  @Post()
  @ApiOperation({
    summary: 'Register a subscription plan',
    description:
      'Maps an AcePay app + plan slug to a provider plan id. For Lemon Squeezy, ' +
      'the provider plan id is the Variant ID of a Subscription-priced variant in your store.',
  })
  create(@Body() dto: CreatePlanDto) {
    return this.plans.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List plans with filters + pagination' })
  list(@Query() q: ListPlansDto) {
    return this.plans.list(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Plan detail' })
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update display name and / or isActive' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto) {
    return this.plans.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Deactivate (soft-delete) a plan',
    description: 'Existing subscriptions are unaffected; new subscriptions on this plan are blocked.',
  })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.deactivate(id);
  }

  @Post(':id/sync')
  @ApiOperation({
    summary: 'Re-verify and sync plan from Lemon Squeezy',
    description:
      "Re-fetches the provider variant and updates amount, currency, interval, and intervalCount " +
      "on the AcePay plan to match. Returns the updated plan plus the fresh provider variant payload.",
  })
  sync(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.syncFromProvider(id);
  }
}
