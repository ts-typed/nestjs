# @ts-typed/nestjs

NestJS integration for [`@ts-typed/compiler`](https://www.npmjs.com/package/@ts-typed/compiler): translates a runtime contract violation (a `StrictTypeError`) into an HTTP response, with a per-property escape hatch for custom messages that can replace a lot of what `class-validator` is normally used for.

```bash
npm install @ts-typed/nestjs
```

```ts
import { StrictTypeErrorFilter } from '@ts-typed/nestjs';

// as a global filter
app.useGlobalFilters(new StrictTypeErrorFilter());

// or scoped to a controller/handler
@UseFilters(StrictTypeErrorFilter)
```

It does not replace Nest's own validation pipes or instantiate DTOs — it only reacts to a `StrictTypeError` ts-typed's own instrumented code already threw (from a DTO field, a provider's return value, an Entity read back from the database, anywhere a typed boundary exists).

## Table of contents

- [How the status code is decided](#how-the-status-code-is-decided)
- [`ServerPopulated()` — telling an Entity apart from a DTO](#serverpopulated--telling-an-entity-apart-from-a-dto)
- [`TypeErrorResponse()` — a per-field alternative to class-validator](#typeerrorresponse--a-per-field-alternative-to-class-validator)
- [`StrictTypeHttpError` — build your own filter](#stricttypehttperror--build-your-own-filter)
- [Example response bodies](#example-response-bodies)
- [Known limitations](#known-limitations)

## How the status code is decided

`StrictTypeErrorFilter` picks a status for a `StrictTypeError` using this priority, highest first:

1. **An explicit [`TypeErrorResponse()`](#typeerrorresponse--a-per-field-alternative-to-class-validator) on the violated field** — its own status (or `400` if none was given). A developer who decorated a field already decided how its violation should look to a client; this always wins.
2. **A server fault** → `500`:
   - the violation's `operation` is `return` or `resolve` (the function/method's OWN body produced a bad value — e.g. a mapper reading a corrupted row), or
   - its `contractKind` is `variable` (a plain local variable, e.g. `const entity = await repo.findOneBy(...)` picking up corrupted data — never the client-facing surface of a request), or
   - the field belongs to a class marked [`ServerPopulated()`](#serverpopulated--telling-an-entity-apart-from-a-dto).
3. **Otherwise** → `400` (client input: a bad DTO field, a bad `@Body()`/`@Param()` argument).

## `ServerPopulated()` — telling an Entity apart from a DTO

A class field (`contractKind: 'property'`) looks identical whether it's a TypeORM Entity reading corrupted data back from the database (a server fault) or a DTO populated by `class-transformer` from client input (a client fault) — both go through the exact same path. Mark your Entity classes to break the tie:

```ts
import { ServerPopulated } from '@ts-typed/nestjs'; // re-exported from @ts-typed/compiler
import { Entity, Column } from 'typeorm';

@Entity({ name: 'todos' })
@ServerPopulated()
export class TodoEntity {
  @Column({ type: 'varchar', enum: TodoStatus })
  public status!: TodoStatus;
}
```

A corrupted `status` value read back from the database now answers `500`; the same kind of violation on an unmarked DTO still answers `400`.

## `TypeErrorResponse()` — a per-field alternative to class-validator

```ts
import { TypeErrorResponse } from '@ts-typed/nestjs'; // re-exported from @ts-typed/compiler

export class CreateUserDto {
  @TypeErrorResponse('Email inválido', 422)
  public readonly email!: string;

  @TypeErrorResponse('Nome deve ter entre 2 e 100 caracteres')
  public readonly name!: string; // no status given -> defaults to 400
}
```

Fires for **any** kind of violation on that field (wrong type, extra property, readonly, …), replacing only the `message` (and `statusCode`, if given) — every other diagnostic field (`code`, `propertyPath`, `expected`, `received`, `contractKind`, `operation`) still comes through, so a client gets your custom message AND the full detail of what was wrong. See [Example response bodies](#example-response-bodies).

This is a **single-violation** mechanism, consistent with the rest of ts-typed: it customizes the response for whichever ONE violation fires on the decorated field, not an aggregate of every violation across the whole DTO the way `class-validator` reports by default (see [Known limitations](#known-limitations)).

## `StrictTypeHttpError` — build your own filter

`StrictTypeErrorFilter` is the batteries-included option. If you want different handling — custom logging, a different response shape, i18n, anything else — `StrictTypeHttpError` exposes the exact same status/message mapping as a reusable building block, so you don't have to reimplement it:

```ts
import { Catch } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { StrictTypeError } from '@ts-typed/compiler';
import { StrictTypeHttpError } from '@ts-typed/nestjs';

@Catch(StrictTypeError)
export class MyOwnFilter implements ExceptionFilter {
  catch(exception: StrictTypeError, host: ArgumentsHost): void {
    const httpError = StrictTypeHttpError.fromStrictTypeError(exception);

    // httpError.getStatus()   -> the resolved status code
    // httpError.getResponse() -> { statusCode, message, code, propertyPath, expected, received, contractKind, operation, ... }
    // httpError.cause         -> the original StrictTypeError, if you need anything not in the body above

    myLogger.warn('validation failed', { path: httpError.cause.propertyPath });

    const response = host.switchToHttp().getResponse();
    response.status(httpError.getStatus()).json({
      ok: false,
      reason: httpError.getResponse().message,
    });
  }
}
```

`StrictTypeHttpError` is a real Nest `HttpException` subclass, so anywhere else that already knows how to render an `HttpException` (Nest's own default exception handling, Swagger's error schema tooling, etc.) understands it without any special-casing.

## Example response bodies

A DTO field without any decorator, a plain type mismatch:

```json
{
  "statusCode": 400,
  "message": "CreateUserDto.age expected number, received string",
  "code": "TYPE_MISMATCH",
  "propertyPath": "CreateUserDto.age",
  "expected": "number",
  "received": "string",
  "contractKind": "property",
  "operation": "initialize"
}
```

The same field decorated `@TypeErrorResponse('Idade inválida', 422)`:

```json
{
  "statusCode": 422,
  "message": "Idade inválida",
  "code": "TYPE_MISMATCH",
  "propertyPath": "CreateUserDto.age",
  "expected": "number",
  "received": "string",
  "contractKind": "property",
  "operation": "initialize"
}
```

A `@ServerPopulated()` Entity field with corrupted data:

```json
{
  "statusCode": 500,
  "message": "TodoEntity.status expected TodoStatus, received string",
  "code": "TYPE_MISMATCH",
  "propertyPath": "TodoEntity.status",
  "expected": "TodoStatus",
  "received": "string",
  "contractKind": "property",
  "operation": "initialize"
}
```

None of these ever include the raw value that failed validation or a stack trace — `StrictTypeError#toJSON()` (which this body is built from) deliberately omits both.

## Known limitations

- **Multiple violations aren't aggregated into one response.** ts-typed validates and populates an object field-by-field, throwing on the FIRST bad field — unlike `class-validator`'s "populate everything, then validate the whole object in one pass, collecting every violation" model. If your API contract needs every field's errors together in one response, you'll need to keep `class-validator` (or something like it) for that specific need; `TypeErrorResponse` and `ServerPopulated` solve per-field message/status customization and entity/DTO disambiguation, not error aggregation. Aggregating is tracked as a possible future, separately-designed enhancement.
- See [`@ts-typed/compiler`'s README](https://www.npmjs.com/package/@ts-typed/compiler) for the underlying library's own scope boundaries (inferred generics, `WeakMap`/`WeakSet`, etc.) — anything not validated there has nothing for this package's filter to react to either.

## License

Apache-2.0
