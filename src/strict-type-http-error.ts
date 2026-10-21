import { HttpException, HttpStatus } from '@nestjs/common';
import type { StrictTypeError, StrictTypeErrorInfo } from '@ts-typed/core';

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
 * `ServerPopulated()` (from `@ts-typed/core`), which makes every
 * `StrictTypeError` thrown for one of that class's fields carry
 * `isServerPopulated: true`.
 *
 * A field decorated with `TypeErrorResponse(message, status?)` (also from
 * `@ts-typed/core`) carries its own custom message — and optionally its
 * own status — on the thrown error, as `typeErrorResponseMessage`/
 * `typeErrorResponseStatus`. Neither is ever present in `toJSON()`'s output
 * (ts-typed deliberately keeps them off the generic serialized shape), so
 * they only ever reach this mapping through the raw exception object. An
 * explicit per-property response like this is a developer's deliberate
 * choice for that field, so it takes priority over the server-fault/client-
 * fault heuristic above, regardless of `contractKind`/`operation`/
 * `isServerPopulated` — the developer already decided how this one field's
 * violation should look to a client.
 */
function resolveStatus(exception: StrictTypeError): number {
  if (exception.typeErrorResponseStatus !== undefined) {
    return exception.typeErrorResponseStatus;
  }
  if (exception.typeErrorResponseMessage !== undefined) {
    return HttpStatus.BAD_REQUEST;
  }
  const isServerFault =
    SERVER_FAULT_OPERATIONS.has(exception.operation) ||
    SERVER_FAULT_CONTRACT_KINDS.has(exception.contractKind) ||
    exception.isServerPopulated === true;
  return isServerFault ? HttpStatus.INTERNAL_SERVER_ERROR : HttpStatus.BAD_REQUEST;
}

function resolveMessage(exception: StrictTypeError): string {
  return exception.typeErrorResponseMessage ?? exception.message;
}

export interface StrictTypeHttpErrorBody extends StrictTypeErrorInfo {
  readonly statusCode: number;
  readonly message: string;
}

/**
 * The HTTP-shaped form of a `StrictTypeError`: a real `HttpException`
 * subclass carrying the already-resolved status and message (same mapping
 * `StrictTypeErrorFilter` uses internally — the 400/500 heuristic,
 * `isServerPopulated`, and `TypeErrorResponse` priority, all applied), plus
 * `StrictTypeError#toJSON()`'s safe diagnostic fields (`code`, `propertyPath`,
 * `expected`, `received`, `contractKind`, `operation`).
 *
 * `StrictTypeErrorFilter` is the batteries-included way to use this — it
 * builds one of these and writes it to the response for you. Build one
 * directly, via `StrictTypeHttpError.fromStrictTypeError(exception)`, when
 * you want to react to the SAME mapping from your OWN `@Catch(StrictTypeError)`
 * filter instead — for custom logging, a different response shape, i18n, or
 * any other handling `StrictTypeErrorFilter` doesn't offer. The original
 * `StrictTypeError` stays available as `cause`.
 */
export class StrictTypeHttpError extends HttpException {
  public readonly cause: StrictTypeError;

  private constructor(body: StrictTypeHttpErrorBody, cause: StrictTypeError) {
    super(body, body.statusCode);
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public static fromStrictTypeError(exception: StrictTypeError): StrictTypeHttpError {
    const statusCode = resolveStatus(exception);
    const body: StrictTypeHttpErrorBody = {
      statusCode,
      message: resolveMessage(exception),
      ...exception.toJSON(),
    };
    return new StrictTypeHttpError(body, exception);
  }
}
