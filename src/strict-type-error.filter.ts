import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import { StrictTypeError } from '@ts-typed/compiler';

interface MinimalHttpResponse {
  status(code: number): MinimalHttpResponse;
  json(body: unknown): unknown;
}

/**
 * A `return`/`resolve` violation means the function or method's OWN body
 * produced a value that fails its declared return type — e.g. a mapper
 * reading a corrupted row out of the database. The client did nothing wrong
 * at that boundary, so it is a server-side failure (500), not a bad request
 * (400). Every other operation (`argument`, `set`, `initialize`, …) reflects
 * a value that came from outside the function at that exact validation
 * point — closer to client-controlled input — and keeps the 400 default.
 */
const SERVER_FAULT_OPERATIONS: ReadonlySet<string> = new Set(['return', 'resolve']);

/**
 * Translates a `StrictTypeError` thrown by instrumented code (a DTO/provider
 * field failing validation at a protected boundary) into an HTTP response,
 * using `StrictTypeError#toJSON()`'s already-safe payload (no raw received
 * value, no stack). Register it the same way as any other Nest exception
 * filter (`@UseFilters(StrictTypeErrorFilter)` or as a global `APP_FILTER`
 * provider); it does not replace Nest's own validation pipes or instantiate
 * DTOs — it only reacts to an error ts-typed's own instrumented code already
 * threw.
 */
@Catch(StrictTypeError)
export class StrictTypeErrorFilter implements ExceptionFilter {
  public catch(exception: StrictTypeError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<MinimalHttpResponse>();
    const status = SERVER_FAULT_OPERATIONS.has(exception.operation)
      ? HttpStatus.INTERNAL_SERVER_ERROR
      : HttpStatus.BAD_REQUEST;
    const httpException = new HttpException({
      statusCode: status,
      message: exception.message,
      ...exception.toJSON(),
    }, status);
    response.status(httpException.getStatus()).json(httpException.getResponse());
  }
}
