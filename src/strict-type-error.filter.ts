import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import { StrictTypeError } from '@ts-typed/compiler';

interface MinimalHttpResponse {
  status(code: number): MinimalHttpResponse;
  json(body: unknown): unknown;
}

/**
 * Translates a `StrictTypeError` thrown by instrumented code (a DTO/provider
 * field failing validation at a protected boundary) into a 400 Bad Request
 * HTTP response, using `StrictTypeError#toJSON()`'s already-safe payload (no
 * raw received value, no stack). Register it the same way as any other Nest
 * exception filter (`@UseFilters(StrictTypeErrorFilter)` or as a global
 * `APP_FILTER` provider); it does not replace Nest's own validation pipes or
 * instantiate DTOs — it only reacts to an error ts-typed's own instrumented
 * code already threw.
 */
@Catch(StrictTypeError)
export class StrictTypeErrorFilter implements ExceptionFilter {
  public catch(exception: StrictTypeError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<MinimalHttpResponse>();
    const httpException = new HttpException({
      statusCode: HttpStatus.BAD_REQUEST,
      message: exception.message,
      ...exception.toJSON(),
    }, HttpStatus.BAD_REQUEST);
    response.status(httpException.getStatus()).json(httpException.getResponse());
  }
}
