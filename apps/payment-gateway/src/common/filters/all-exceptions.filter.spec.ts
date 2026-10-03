import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function mockHost(reqOverrides: Record<string, unknown> = {}): {
  host: ArgumentsHost;
  res: { status: jest.Mock; json: jest.Mock; setHeader: jest.Mock; body?: unknown; statusCode?: number };
} {
  const res: {
    status: jest.Mock; json: jest.Mock; setHeader: jest.Mock; body?: unknown; statusCode?: number;
  } = {
    setHeader: jest.fn(),
    status: jest.fn().mockImplementation(function (this: unknown, c: number) {
      (res as { statusCode?: number }).statusCode = c;
      return res;
    }),
    json: jest.fn().mockImplementation(function (this: unknown, b: unknown) {
      (res as { body?: unknown }).body = b;
      return res;
    }),
  };
  const req = {
    method: 'POST',
    url: '/v1/subscriptions',
    header: (name: string) => (reqOverrides as Record<string, string>)[name],
    ...reqOverrides,
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('wraps a guard-style HttpException into the envelope, preserving code + message', () => {
    const { host, res } = mockHost();
    filter.catch(
      new UnauthorizedException({ error: 'invalid_api_key', message: 'API key is not recognized' }),
      host,
    );
    expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    expect(res.body).toEqual({
      error: expect.objectContaining({
        code: 'invalid_api_key',
        message: 'API key is not recognized',
        requestId: expect.any(String),
      }),
    });
  });

  it('always attaches a requestId and echoes it as a header', () => {
    const { host, res } = mockHost();
    filter.catch(new ForbiddenException('nope'), host);
    const requestId = (res.body as { error: { requestId: string } }).error.requestId;
    expect(requestId).toBeTruthy();
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', requestId);
  });

  it('reuses an incoming x-request-id', () => {
    const { host, res } = mockHost({ 'x-request-id': 'req-abc-123' });
    filter.catch(new BadRequestException('bad'), host);
    expect((res.body as { error: { requestId: string } }).error.requestId).toBe('req-abc-123');
  });

  it('joins class-validator message arrays into one string', () => {
    const { host, res } = mockHost();
    filter.catch(
      new BadRequestException({ message: ['amount must be positive', 'currency is required'] }),
      host,
    );
    expect((res.body as { error: { message: string } }).error.message).toBe(
      'amount must be positive, currency is required',
    );
  });

  it('classifies a provider SDK error as a 502 provider_error', () => {
    const { host, res } = mockHost();
    filter.catch(new Error('Lemon Squeezy createCheckout failed: rate limited'), host);
    expect(res.statusCode).toBe(HttpStatus.BAD_GATEWAY);
    expect((res.body as { error: { code: string } }).error.code).toBe('provider_error');
  });

  it('classifies an unknown error as a 500 internal_error and shows the message in dev', () => {
    const { host, res } = mockHost();
    filter.catch(new Error('undefined is not a function'), host);
    expect(res.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).toBe('undefined is not a function');
  });

  it('hides the internal message in production', () => {
    process.env.NODE_ENV = 'production';
    const prodFilter = new AllExceptionsFilter();
    const { host, res } = mockHost();
    prodFilter.catch(new Error('secret db connection string leaked'), host);
    expect((res.body as { error: { message: string } }).error.message).toBe('Internal server error');
  });

  it('maps a plain string HttpException body', () => {
    const { host, res } = mockHost();
    filter.catch(new HttpException('teapot', 418), host);
    expect(res.statusCode).toBe(418);
    expect((res.body as { error: { message: string } }).error.message).toBe('teapot');
  });
});
