import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch } from '@nestjs/common';
import { StrictTypeError } from '@ts-typed/core';
import { StrictTypeHttpError } from './strict-type-http-error';

interface MinimalHttpResponse {
  status(code: number): MinimalHttpResponse;
  json(body: unknown): unknown;
}

/**
 * Translates a `StrictTypeError` thrown by instrumented code (a DTO/provider
 * field failing validation at a protected boundary) into an HTTP response,
 * via {@link StrictTypeHttpError} — same safe payload as
 * `StrictTypeError#toJSON()` (no raw received value, no stack), with the
 * status/message already resolved. Register it the same way as any other
 * Nest exception filter (`@UseFilters(StrictTypeErrorFilter)` or as a global
 * `APP_FILTER` provider); it does not replace Nest's own validation pipes or
 * instantiate DTOs — it only reacts to an error ts-typed's own instrumented
 * code already threw.
 *
 * Want different handling (custom logging, a different response shape,
 * i18n, …)? Write your own `@Catch(StrictTypeError)` filter and call
 * `StrictTypeHttpError.fromStrictTypeError(exception)` yourself — it's the
 * same mapping this filter uses, just not tied to writing the response for you.
 */
@Catch(StrictTypeError)
export class StrictTypeErrorFilter implements ExceptionFilter {
  public catch(exception: StrictTypeError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<MinimalHttpResponse>();
    const httpError = StrictTypeHttpError.fromStrictTypeError(exception);
    response.status(httpError.getStatus()).json(httpError.getResponse());
  }
}
