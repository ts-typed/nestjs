import type { ArgumentMetadata } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { withDeferredReadonlyLock } from '@ts-typed/core';

/**
 * Drop-in replacement for Nest's `ValidationPipe`. Nest's own pipe builds a
 * DTO instance with `class-transformer`'s `plainToInstance` and then assigns
 * the payload's keys onto it as separate property writes — including into
 * `readonly` fields that already have an initializer, which ts-typed locks at
 * the end of the (no-arg) constructor it ran to produce that instance. Without
 * this wrapper, those writes hit a locked field and throw `READONLY_PROPERTY`
 * even though the pipe is doing exactly the "construct and populate" ts-typed
 * means to allow. Wrapping `transform()` in `withDeferredReadonlyLock` defers
 * those locks until the pipe's whole (possibly async) transform settles, so
 * `plainToInstance`'s writes land first and the field is still locked by the
 * time the request handler sees the DTO.
 */
export class TypedValidationPipe extends ValidationPipe {
  public override async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return withDeferredReadonlyLock(() => super.transform(value, metadata));
  }
}
