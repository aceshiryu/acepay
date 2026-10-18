import { Body, Controller, Get, Param, ParseEnumPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../auth/admin.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Provider } from '../../common/enums';
import { User } from '../../database/entities';
import { IntegrationsAdminService } from './integrations-admin.service';

/** Not a class-validator DTO: the keys are env var names, checked against the
 *  provider's catalog entry in the service. */
interface SaveCredentialsBody {
  values: Record<string, string | null>;
}

@ApiTags('admin/integrations')
@ApiBearerAuth('admin')
@Controller('admin/integrations')
@UseGuards(AdminGuard)
export class IntegrationsAdminController {
  constructor(private readonly integrations: IntegrationsAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Every payment provider: config status (secrets masked), test/live mode, webhook URLs + health' })
  list() {
    return this.integrations.list();
  }

  @Post(':provider/test')
  @ApiOperation({ summary: 'Make one cheap authenticated call to the provider to prove the credentials work' })
  test(@Param('provider', new ParseEnumPipe(Provider)) provider: Provider) {
    return this.integrations.test(provider);
  }

  @Put(':provider/credentials')
  @ApiOperation({
    summary: 'Save provider credentials (encrypted; they override .env). A null value clears the saved one so .env applies again.',
  })
  @ApiBody({ schema: { example: { values: { PAYMONGO_SECRET_KEY: 'sk_test_…', PAYMONGO_PAYMENT_METHODS: null } } } })
  saveCredentials(
    @Param('provider', new ParseEnumPipe(Provider)) provider: Provider,
    @Body() body: SaveCredentialsBody,
    @CurrentUser() user: User,
  ) {
    return this.integrations.saveCredentials(provider, body?.values ?? {}, user?.email ?? null);
  }
}
