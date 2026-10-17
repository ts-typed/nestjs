# @ts-typed/nestjs

NestJS integration for `@ts-typed/compiler`. It provides the versioned `nestjs` project-resolution adapter and `StrictTypeErrorFilter`, which translates a runtime contract violation to a safe HTTP 400 response.

```ts
import { StrictTypeErrorFilter } from '@ts-typed/nestjs';
```

Register the filter with Nest in the usual way. It does not instantiate DTOs or replace Nest validation pipes. Licensed under Apache-2.0.
