import { Controller, Get } from '@nestjs/common';

/**
 * The worker doesn't otherwise expose HTTP — its real job is draining Bull
 * queues. These endpoints are here so App Engine / Cloud Run / load balancer
 * health checks see a 200 response and know the process is alive.
 */
@Controller()
export class HealthController {
  @Get('/health')
  health() {
    return { status: 'ok' };
  }

  @Get('/')
  root() {
    return { service: 'acepay-payment-worker', status: 'ok' };
  }
}
