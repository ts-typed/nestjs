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
 * A plain local variable (`const entity = await repo.findOneBy(...)`) is
 * never the client-facing surface of a request: client input only ever
 * reaches a protected contract through a `parameter` (`@Body()`/`@Param()`
 * decorated arguments, which use the `argument` operation, never
 * `variable`) or a `property` (a DTO's own fields). A violation whose
 * `contractKind` is `variable` is therefore always a server-side data
 * problem — typically corrupted data read back from a database — even
 * though its `operation` is `initialize`/`set`, which otherwise means
 * "value came from outside this function" and defaults to 400.
 */
const SERVER_FAULT_CONTRACT_KINDS: ReadonlySet<string> = new Set(['variable']);

/**
 * A class field (`contractKind: 'property'`) is otherwise indistinguishable
 * between a TypeORM Entity (corrupted database row — a server fault) and a
 * DTO populated by `class-transformer` from client input (a client fault) —
 * both go through the exact same `contractKind`/`operation` path. The app
 * breaks that tie explicitly by marking its Entity classes with
 * `ServerPopulated()` (from `@ts-typed/compiler`), which makes every
 * `StrictTypeError` thrown for one of that class's fields carry
 * `isServerPopulated: true`.
 */

/**
 * A field decorated with `TypeErrorResponse(message, status?)` (from
 * `@ts-typed/compiler`) carries its own custom message — and optionally its
 * own status — on the thrown error, as `typeErrorResponseMessage`/
 * `typeErrorResponseStatus`. Neither is ever present in `toJSON()`'s output
 * (ts-typed deliberately keeps them off the generic serialized shape), so
 * they only ever reach this filter through the raw exception object. An
 * explicit per-property response like this is a developer's deliberate
 * choice for that field, so it takes priority over the server-fault/client-
 * fault heuristic below, regardless of `contractKind`/`operation`/
 * `isServerPopulated` — the developer already decided how this one field's
 * violation should look to a client.
 */
function buildTypeErrorResponse(
  exception: StrictTypeError,
): { readonly statusCode: number; readonly message: string } | undefined {
  if (exception.typeErrorResponseMessage === undefined) {
    return undefined;
  }
  return {
    statusCode: exception.typeErrorResponseStatus ?? HttpStatus.BAD_REQUEST,
    message: exception.typeErrorResponseMessage,
  };
}

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
    const customResponse = buildTypeErrorResponse(exception);
    const status = customResponse?.statusCode ??
      (SERVER_FAULT_OPERATIONS.has(exception.operation) ||
        SERVER_FAULT_CONTRACT_KINDS.has(exception.contractKind) ||
        exception.isServerPopulated === true
        ? HttpStatus.INTERNAL_SERVER_ERROR
        : HttpStatus.BAD_REQUEST);
    const httpException = new HttpException({
      statusCode: status,
      message: customResponse?.message ?? exception.message,
      ...exception.toJSON(),
    }, status);
    response.status(httpException.getStatus()).json(httpException.getResponse());
  }
}
