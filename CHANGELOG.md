# Changelog

All notable changes to `@ts-typed/nestjs` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
