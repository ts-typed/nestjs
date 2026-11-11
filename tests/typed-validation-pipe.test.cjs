'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

require('reflect-metadata');

const { MinLength } = require('class-validator');
const { Body, Controller, Module, Post, UseFilters } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { installFieldGuard, lockReadonlyField, StrictTypeError } = require('@ts-typed/core');
const { StrictTypeErrorFilter, TypedValidationPipe } = require('../dist');

// Hand-written stand-in for the constructor ts-typed's compiler emits for
// `readonly name = ''`. These runtime calls are what the compiler would emit;
// `lockReadonlyField` itself defers when called inside `withDeferredReadonlyLock`,
// which is what `TypedValidationPipe` wraps around `transform()`.
class CreateUserDto {
  constructor() {
    this.name = '';
    installFieldGuard(this, 'name', { kind: 'primitive', name: 'string' },
      { contractKind: 'property', operation: 'initialize', propertyPath: 'CreateUserDto.name' },
      { initialized: true, readonlyField: true });
    lockReadonlyField(this, 'name');
  }
}
MinLength(2)(CreateUserDto.prototype, 'name');

test('TypedValidationPipe lets class-transformer populate a readonly field that ts-typed already locked, instead of throwing READONLY_PROPERTY', async () => {
  const pipe = new TypedValidationPipe({ transform: true });
  const metadata = { type: 'body', metatype: CreateUserDto, data: undefined };

  const result = await pipe.transform({ name: 'Patrick' }, metadata);

  assert.ok(result instanceof CreateUserDto);
  assert.equal(result.name, 'Patrick');
});

test('TypedValidationPipe still locks the field by the time the request handler runs: a later write throws READONLY_PROPERTY', async () => {
  const pipe = new TypedValidationPipe({ transform: true });
  const metadata = { type: 'body', metatype: CreateUserDto, data: undefined };

  const result = await pipe.transform({ name: 'Patrick' }, metadata);

  assert.throws(() => {
    result.name = 'someone else';
  }, (error) => error instanceof StrictTypeError && error.code === 'READONLY_PROPERTY');
});

test('TypedValidationPipe still rejects invalid input the same way the base ValidationPipe does (class-validator failure, unrelated to the readonly lock)', async () => {
  const pipe = new TypedValidationPipe({ transform: true });
  const metadata = { type: 'body', metatype: CreateUserDto, data: undefined };

  await assert.rejects(
    pipe.transform({ name: 'x' }, metadata),
    (error) => error?.getStatus?.() === 400,
  );
});

test('a real Nest HTTP route using TypedValidationPipe accepts a valid body and the readonly field is already locked in the handler', async (t) => {
  class TestController {
    create(dto) {
      try {
        dto.name = 'x';
      } catch (err) {
        return { received: dto.name, lockedCode: err?.code };
      }
      return { received: dto.name };
    }
  }
  Controller('users')(TestController);
  // Plain JS has no `emitDecoratorMetadata`; without this, Nest passes `metatype: undefined` and `ValidationPipe` skips transform/validation entirely.
  Reflect.defineMetadata('design:paramtypes', [CreateUserDto], TestController.prototype, 'create');
  const descriptor = Object.getOwnPropertyDescriptor(TestController.prototype, 'create');
  Post()(TestController.prototype, 'create', descriptor);
  Body(new TypedValidationPipe({ transform: true }))(TestController.prototype, 'create', 0);
  UseFilters(StrictTypeErrorFilter)(TestController.prototype, 'create', descriptor);

  class TestModule {}
  Module({ controllers: [TestController] })(TestModule);

  const application = await NestFactory.create(TestModule, { logger: false });
  t.after(async () => application.close());
  await application.listen(0, '127.0.0.1');
  const address = application.getHttpServer().address();

  const response = await fetch(`http://127.0.0.1:${address.port}/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Patrick' }),
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(body, { received: 'Patrick', lockedCode: 'READONLY_PROPERTY' });
});

test('a real Nest HTTP route using TypedValidationPipe returns 400 for an invalid body, via class-validator, without an unhandled async throw', async (t) => {
  class TestController {
    create(dto) {
      return { received: dto.name };
    }
  }
  Controller('users-invalid')(TestController);
  // Plain JS has no `emitDecoratorMetadata`; without this, Nest passes `metatype: undefined` and `ValidationPipe` skips transform/validation entirely.
  Reflect.defineMetadata('design:paramtypes', [CreateUserDto], TestController.prototype, 'create');
  const descriptor = Object.getOwnPropertyDescriptor(TestController.prototype, 'create');
  Post()(TestController.prototype, 'create', descriptor);
  Body(new TypedValidationPipe({ transform: true }))(TestController.prototype, 'create', 0);
  UseFilters(StrictTypeErrorFilter)(TestController.prototype, 'create', descriptor);

  class TestModule {}
  Module({ controllers: [TestController] })(TestModule);

  const application = await NestFactory.create(TestModule, { logger: false });
  t.after(async () => application.close());
  await application.listen(0, '127.0.0.1');
  const address = application.getHttpServer().address();

  let uncaught;
  const onUncaught = (err) => {
    uncaught = err;
  };
  process.once('uncaughtException', onUncaught);

  const response = await fetch(`http://127.0.0.1:${address.port}/users-invalid`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x' }),
  });

  assert.equal(response.status, 400);
  await new Promise((resolve) => setImmediate(resolve));
  process.removeListener('uncaughtException', onUncaught);
  assert.equal(uncaught, undefined, `an unhandled async error was thrown: ${uncaught?.stack}`);
});
