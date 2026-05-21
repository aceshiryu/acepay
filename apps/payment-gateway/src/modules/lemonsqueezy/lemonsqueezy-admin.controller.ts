import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../auth/admin.guard';
import { LemonsqueezyAdapter, LookedUpVariant } from '../../payment-providers/lemonsqueezy.adapter';

@ApiTags('admin/lemonsqueezy')
@ApiBearerAuth('admin')
@UseGuards(AdminGuard)
@Controller('admin/lemonsqueezy')
export class LemonsqueezyAdminController {
  constructor(private readonly ls: LemonsqueezyAdapter) {}

  @Get('variants/:id')
  @ApiOperation({
    summary: 'Look up a Lemon Squeezy variant by ID',
    description:
      'Used by the admin UI to verify operator-pasted variant IDs and auto-fill plan details ' +
      '(name, price, currency, interval, subscription/one-time flag).',
  })
  async getVariant(@Param('id') id: string): Promise<LookedUpVariant> {
    return this.ls.lookupVariant(id);
  }
}
