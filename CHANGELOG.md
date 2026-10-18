# Changelog

All notable changes to `@ts-typed/nestjs` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.16] - 2026-10-18

### Changed

- Depends on `@ts-typed/compiler@0.1.22` (fixes `ValueObject` subclass detection for a class imported with `import type { X }`). No code changes in this package itself.

## [0.1.15] - 2026-10-18

### Changed

- Depends on `@ts-typed/compiler@0.1.21` (completes the `ValueObject` auto-constructed value types feature end to end — see that package's CHANGELOG). No code changes in this package itself.

## [0.1.14] - 2026-10-18

### Changed

- Depends on `@ts-typed/compiler@0.1.20` (adds the `ValueObject` base class and runtime auto-construction at boundaries, step 1-2 of a new feature; no code changes needed in this package since it has no HTTP-specific interaction with `ValueObject`). No code changes in this package itself.

## [0.1.13] - 2026-10-18

### Changed

- Depends on `@ts-typed/compiler@0.1.18`. The 0.1.12 release bumped this package's own version for a documentation-only change but missed re-syncing the pinned compiler dependency (left at `0.1.17` while the app's own direct dependency had already moved to `0.1.18`) — the same cross-package version-identity bug documented in the 0.1.3 and 0.1.8 changelog entries (two separate `StrictTypeError` classes at runtime). No code changes in this package itself.

## [0.1.12] - 2026-10-18

### Documentation

- Full `README.md` rewrite: how the 400/500 status is decided, `ServerPopulated()` and `TypeErrorResponse()` usage with real DTO/Entity examples, `StrictTypeHttpError` for building a custom filter, example response bodies for each case, and known limitations (including the fail-fast/no-aggregation scope boundary). No code changes.

## [0.1.11] - 2026-10-18

### Added

- A new `StrictTypeHttpError` class (extends Nest's `HttpException`) exposes the exact status/message mapping `StrictTypeErrorFilter` uses internally (the 400/500 server-fault heuristic, `isServerPopulated`, and `TypeErrorResponse` priority) as a standalone, reusable building block. `StrictTypeErrorFilter` is unchanged behavior-wise — it now builds a `StrictTypeHttpError` internally and writes it to the response, exactly as before. The new piece is for anyone who wants different handling than `StrictTypeErrorFilter` provides (custom logging, a different response body shape, i18n, …): write your own `@Catch(StrictTypeError)` filter and call `StrictTypeHttpError.fromStrictTypeError(exception)` to get the same resolved status/message/diagnostic fields (`code`, `propertyPath`, `expected`, `received`, `contractKind`, `operation`) without reimplementing any of the mapping logic. The original `StrictTypeError` stays available as `httpError.cause`.

## [0.1.10] - 2026-10-18

### Added

- `StrictTypeErrorFilter` now honors a field's `TypeErrorResponse(message, status?)` decorator (from `@ts-typed/compiler@0.1.17`): when the thrown error carries `typeErrorResponseMessage`, the filter responds with that custom message and status (default `400`) instead of ts-typed's own message, as a per-property alternative to `class-validator`. The rest of the body stays the same shape as always — `code`, `propertyPath`, `expected`, `received`, `contractKind`, `operation` — so a client gets the custom message AND the full diagnostic detail (which type was expected, what was received, etc.) together. An explicit `TypeErrorResponse` takes PRIORITY over the `isServerPopulated`/`return`-`resolve`/`variable` server-fault heuristic — a developer who explicitly decorated a field already decided how that field's violation should look to a client, regardless of what the generic heuristic would otherwise pick. `TypeErrorResponse`/`TypeErrorResponseOptions` are re-exported from `@ts-typed/nestjs` directly, so `import { TypeErrorResponse } from '@ts-typed/nestjs'` works without a separate `@ts-typed/compiler` import.

  **This is still a single-violation (fail-fast) mechanism** — it customizes the response for whichever ONE violation fires on the decorated property, not an aggregate of every violation across a DTO the way `class-validator` reports by default. Aggregating multiple violations into one response is a separate, materially larger change (ts-typed validates and populates a DTO field-by-field, throwing on the first bad field, unlike `class-validator`'s "populate everything, then validate the whole object in one pass" model) — tracked as a future enhancement, not attempted here.

### Changed

- Depends on `@ts-typed/compiler@0.1.17` (adds the `TypeErrorResponse` decorator this release consumes).

## [0.1.9] - 2026-10-18

### Changed

- Depends on `@ts-typed/compiler@0.1.16` (0.1.15 extends `GENERIC_TRANSPORT` call-site validation to `new` expressions; 0.1.16 extends it further to rest parameters and spread arguments). No code changes in this package itself.

## [0.1.8] - 2026-10-18

### Changed

- Depends on `@ts-typed/compiler@0.1.14` (0.1.13 extends `enforceMutationGuards` to nested arrays/Maps/Sets/objects recursively; 0.1.14 extends `GENERIC_TRANSPORT`'s call-site validation to an `async` function's resolved return value). No code changes in this package itself.

## [0.1.7] - 2026-10-18

### Added

- Closes `FILTER_STATUS_FOR_ENTITY_HYDRATION`: `StrictTypeErrorFilter` now also treats `exception.isServerPopulated === true` as a server fault (alongside the existing `return`/`resolve`-operation and `variable`-contractKind checks), mapping it to HTTP 500 instead of 400. A class field (`contractKind: 'property'`) is otherwise indistinguishable between a TypeORM Entity reading corrupted data back from the database (a server fault) and a DTO populated from client input by `class-transformer` (a client fault) — both go through the exact same `contractKind`/`operation` path. The app now breaks that tie explicitly, by marking its Entity classes with `@ts-typed/compiler`'s new `ServerPopulated()` decorator (0.1.12): every `StrictTypeError` thrown for one of that class's fields then carries `isServerPopulated: true`, which this filter checks directly on the caught exception object — the flag is never present in the HTTP response body, since `StrictTypeError#toJSON()` deliberately excludes it.

### Changed

- Depends on `@ts-typed/compiler@0.1.12` (adds the `ServerPopulated()` marker this release relies on).

## [0.1.6] - 2026-10-18

### Changed

- Depends on `@ts-typed/compiler@0.1.11` (closes `GENERIC_TRANSPORT` for explicit type arguments). No code changes in this package itself.

## [0.1.5] - 2026-10-18

### Changed

- Depends on `@ts-typed/compiler@0.1.10` (extends the opt-in `enforceMutationGuards` flag to plain objects/interfaces in 0.1.10, closing `SEALED_OBJECTS` and the plain-object half of `REFLECTIVE_MUTATION`). No code changes in this package itself.

## [0.1.4] - 2026-10-18

### Changed

- Depends on `@ts-typed/compiler@0.1.9` (adds the opt-in `enforceClosedInstances` flag in 0.1.7, and extends the opt-in `enforceMutationGuards` flag to arrays in 0.1.8 and to `Map`/`Set` in 0.1.9). No code changes in this package itself — the same exact-pin re-sync routine as 0.1.3, done this time right after each compiler release instead of a few releases late.

## [0.1.3] - 2026-10-18

### Changed

- Depends on `@ts-typed/compiler@0.1.6` (adds type-predicate/assertion-function validation in 0.1.5, and `exports`-level protection for exported `let`/`var` bindings in 0.1.6). No code changes in this package itself. Re-confirms, the hard way, why this exact-pinned bump must happen every time the compiler releases: skipping it for a few compiler releases let a consuming app's own `@ts-typed/compiler` devDependency drift ahead of this package's pinned transitive one, which gives the two packages two separate `StrictTypeError` classes at runtime (one per resolved module instance) — `@Catch(StrictTypeError)` then silently stops matching the exception the app throws, since it's an `instanceof` of the *other* class. Caught by teste-ts-typed's real `npm install` (not the dist-overlay shortcut, which never changes which copy is resolved) surfacing 8 failing HTTP filter/integration tests; fixed by this version bump alone, no source change needed.

## [0.1.2] - 2026-10-17

### Changed

- Depends on `@ts-typed/compiler@0.1.2`, which fixes a severe regression 0.1.1 introduced (a readonly field with `?`/`!` locked immediately, breaking class-transformer-built DTOs) and adds `static` field and `Map`/`Set` support. No code changes in this package itself; this bump keeps both packages pinned to compatible, non-duplicated versions of `StrictTypeError` (an exact-pinned transitive dependency on a different compiler version than the app's own direct dependency would create two separate `StrictTypeError` classes, breaking `instanceof` checks across the package boundary).

## [0.1.1] - 2026-10-17

### Fixed

- `StrictTypeErrorFilter` kept returning HTTP 400 for a violation on a plain local variable (e.g. `const entity = await repo.findOneBy(...)` reading corrupted data back from a database) because the value flowed through an `initialize`/`set` operation, not `return`/`resolve`. A local variable is never the client-facing surface of a request — client input only ever reaches a protected contract through a `parameter` or a `property` (a DTO's own fields) — so a violation whose `contractKind` is `variable` now also maps to HTTP 500, regardless of its `operation`.

### Changed

- Depends on `@ts-typed/compiler@0.1.1`.

## [0.1.0] - 2026-10-17

### Fixed

- `StrictTypeErrorFilter` returned HTTP 400 for every `StrictTypeError`, including one raised while validating a function or method's own return value (for example, a mapper reading a corrupted row out of the database) — a server-side failure, not a bad request. A violation whose `operation` is `return` or `resolve` now maps to HTTP 500; every other operation (`argument`, `set`, `initialize`, …) keeps the existing 400.
- The package's `exports` map did not expose `./package.json`, breaking `require.resolve('@ts-typed/nestjs/package.json')` and similar version-probing patterns.

### Changed

- Depends on `@ts-typed/compiler@0.1.0`, whose changelog covers the coverage gaps (class methods/constructors, decorated fields, `Date`) that this package's own tests exercise against a real NestJS app.

## [0.0.1] - 2026-10-16

Initial release.

### Added

- `nestjsIntegrationAdapter` (`IntegrationAdapterV1`): resolves a Nest project's `tsconfig.build.json` from `nest-cli.json`'s `compilerOptions.tsConfigPath` when the consumer's own `typets.config.json` does not set `tsconfig` explicitly.
- `StrictTypeErrorFilter`: a Nest `ExceptionFilter` (`@Catch(StrictTypeError)`) that turns a `StrictTypeError` thrown by instrumented code — for example, a controller parameter DTO failing structural validation — into a 400 Bad Request response using `StrictTypeError#toJSON()`'s already-safe payload (no raw value, no stack). Does not replace Nest's own validation pipes and does not instantiate DTOs itself.
- `installGlobalStrictTypeErrorFilter`: used by `ts-typed init` to register `StrictTypeErrorFilter` globally in a conventional `NestFactory.create(...)` bootstrap (`src/main.ts` by convention, or `nest-cli.json`'s `sourceRoot`). Idempotent — detects an existing registration and an ambiguous/non-conventional bootstrap and leaves the file untouched in both cases, returning an actionable message instead of guessing.

### Requirements

- Peer dependencies: `@nestjs/common` and `@nestjs/core` `>=10 <13`, `typescript >=5.9 <6`.
- Depends on `@ts-typed/compiler` for `StrictTypeError` and the integration contract; does not duplicate runtime validation logic.

### Known limits

- `installGlobalStrictTypeErrorFilter` only recognizes a conventional, single top-level `const app = await NestFactory.create(...)` bootstrap. More elaborate bootstrap files (multiple applications, factory wrapped in a helper function, etc.) are left untouched; register `StrictTypeErrorFilter` manually in those cases.
