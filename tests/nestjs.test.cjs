const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

require('reflect-metadata');

const { Controller, Get, Module, UseFilters } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { StrictTypeError, AggregateStrictTypeError } = require('@ts-typed/compiler');
const { resolveProject: resolveCoreProject } = require('@ts-typed/compiler/integration');
const {
  nestjsIntegrationAdapter,
  resolveProject,
  StrictTypeErrorFilter,
  StrictTypeHttpError,
} = require('../dist');

test('the Nest adapter resolves nest-cli tsConfigPath and honors explicit config', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'ts-typed-nest-'));
  writeFileSync(
    join(projectRoot, 'nest-cli.json'),
    JSON.stringify({ compilerOptions: { tsConfigPath: 'tsconfig.build.json' } }),
  );

  assert.equal(nestjsIntegrationAdapter.apiVersion, 1);
  assert.equal(nestjsIntegrationAdapter.name, 'nestjs');
  assert.equal(nestjsIntegrationAdapter.resolveProject, resolveProject);
  assert.equal(typeof nestjsIntegrationAdapter.installGlobalStrictTypeErrorFilter, 'function');
  assert.deepEqual(resolveProject({ projectRoot }), {
    apiVersion: 1,
    integration: 'nestjs',
    projectRoot,
    configPath: join(projectRoot, 'tsconfig.build.json'),
  });
  assert.deepEqual(resolveProject({ projectRoot, configPath: '/consumer/tsconfig.json' }), {
    apiVersion: 1,
    integration: 'nestjs',
    projectRoot,
    configPath: '/consumer/tsconfig.json',
  });
});

test('the Nest adapter safely registers the global filter once in a conventional bootstrap', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'ts-typed-nest-bootstrap-'));
  const sourceRoot = join(projectRoot, 'src');
  require('node:fs').mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(join(projectRoot, 'nest-cli.json'), JSON.stringify({ sourceRoot: 'src' }));
  const mainPath = join(sourceRoot, 'main.ts');
  writeFileSync(
    mainPath,
    [
      "import { NestFactory } from '@nestjs/core';",
      "import { AppModule } from './app.module';",
      '',
      'async function bootstrap(): Promise<void> {',
      '  const app = await NestFactory.create(AppModule);',
      '  await app.listen(process.env.PORT ?? 3000);',
      '}',
      'void bootstrap();',
      '',
    ].join('\n'),
  );

  const first = nestjsIntegrationAdapter.installGlobalStrictTypeErrorFilter({ projectRoot });
  const configured = require('node:fs').readFileSync(mainPath, 'utf8');
  const second = nestjsIntegrationAdapter.installGlobalStrictTypeErrorFilter({ projectRoot });

  assert.deepEqual(first, {
    changed: true,
    message: 'Registered StrictTypeErrorFilter globally in src/main.ts.',
  });
  assert.match(configured, /import \{ StrictTypeErrorFilter \} from '@ts-typed\/nestjs';/);
  assert.match(configured, /app\.useGlobalFilters\(new StrictTypeErrorFilter\(\)\);/);
  assert.equal((configured.match(/StrictTypeErrorFilter/g) ?? []).length, 2);
  assert.deepEqual(second, {
    changed: false,
    message: 'StrictTypeErrorFilter is already registered globally in src/main.ts.',
  });
});

test('resolveProject falls back to defaults instead of crashing on a malformed nest-cli.json', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'ts-typed-nest-malformed-'));
  writeFileSync(
    join(projectRoot, 'nest-cli.json'),
    JSON.stringify({ sourceRoot: 7, compilerOptions: { tsConfigPath: null } }),
  );

  assert.deepEqual(resolveProject({ projectRoot }), {
    apiVersion: 1,
    integration: 'nestjs',
    projectRoot,
  });
});

test('the Nest adapter does not mistake a comment mentioning StrictTypeErrorFilter for an existing registration', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'ts-typed-nest-comment-'));
  const sourceRoot = join(projectRoot, 'src');
  require('node:fs').mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(join(projectRoot, 'nest-cli.json'), JSON.stringify({ sourceRoot: 'src' }));
  const mainPath = join(sourceRoot, 'main.ts');
  writeFileSync(
    mainPath,
    [
      "import { NestFactory } from '@nestjs/core';",
      "import { AppModule } from './app.module';",
      '',
      '// TODO: register StrictTypeErrorFilter and app.useGlobalFilters( later',
      'async function bootstrap(): Promise<void> {',
      '  const app = await NestFactory.create(AppModule);',
      '  await app.listen(process.env.PORT ?? 3000);',
      '}',
      'void bootstrap();',
      '',
    ].join('\n'),
  );

  const result = nestjsIntegrationAdapter.installGlobalStrictTypeErrorFilter({ projectRoot });

  assert.equal(result.changed, true);
  const configured = require('node:fs').readFileSync(mainPath, 'utf8');
  assert.match(configured, /app\.useGlobalFilters\(new StrictTypeErrorFilter\(\)\);/);
});

test('the Nest adapter recognizes an already-registered filter imported under an alias', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'ts-typed-nest-alias-'));
  const sourceRoot = join(projectRoot, 'src');
  require('node:fs').mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(join(projectRoot, 'nest-cli.json'), JSON.stringify({ sourceRoot: 'src' }));
  const mainPath = join(sourceRoot, 'main.ts');
  writeFileSync(
    mainPath,
    [
      "import { NestFactory } from '@nestjs/core';",
      "import { StrictTypeErrorFilter as F } from '@ts-typed/nestjs';",
      "import { AppModule } from './app.module';",
      '',
      'async function bootstrap(): Promise<void> {',
      '  const app = await NestFactory.create(AppModule);',
      '  app.useGlobalFilters(new F());',
      '  await app.listen(process.env.PORT ?? 3000);',
      '}',
      'void bootstrap();',
      '',
    ].join('\n'),
  );
  const before = require('node:fs').readFileSync(mainPath, 'utf8');

  const result = nestjsIntegrationAdapter.installGlobalStrictTypeErrorFilter({ projectRoot });

  assert.deepEqual(result, {
    changed: false,
    message: 'StrictTypeErrorFilter is already registered globally in src/main.ts.',
  });
  assert.equal(require('node:fs').readFileSync(mainPath, 'utf8'), before);
});

test('the published Nest package is loadable as the configured integration module', () => {
  // One level up from tests/ is this package's own root (package.json names
  // "@ts-typed/nestjs" and has "exports"), so Node's self-reference
  // resolution finds it directly — independent of whether this repository
  // is standalone or hoisted inside a workspace.
  const projectRoot = join(__dirname, '..');

  const resolution = resolveCoreProject({ projectRoot }, '@ts-typed/nestjs');

  assert.deepEqual(resolution, {
    apiVersion: 1,
    integration: 'nestjs',
    projectRoot,
  });
});

test('the Nest error filter exposes only StrictTypeError safe metadata as HTTP 400', () => {
  const exception = new StrictTypeError({
    code: 'TYPE_MISMATCH',
    contractKind: 'parameter',
    propertyPath: 'CreateUserDto.age',
    expected: 'number',
    received: 'string',
    operation: 'assign',
  });
  const sent = { status: undefined, body: undefined };
  const response = {
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return body;
    },
  };
  const host = {
    switchToHttp() {
      return { getResponse: () => response };
    },
  };

  new StrictTypeErrorFilter().catch(exception, host);

  assert.equal(sent.status, 400);
  assert.deepEqual(sent.body, {
    statusCode: 400,
    message: 'CreateUserDto.age expected number, received string',
    code: 'TYPE_MISMATCH',
    contractKind: 'parameter',
    propertyPath: 'CreateUserDto.age',
    expected: 'number',
    received: 'string',
    operation: 'assign',
  });
});

test('the Nest error filter returns HTTP 500 for a return-value violation (B10)', () => {
  const exception = new StrictTypeError({
    code: 'TYPE_MISMATCH',
    contractKind: 'return',
    propertyPath: 'UserMapper.toDto.createdAt',
    expected: 'Date',
    received: 'string',
    operation: 'return',
  });
  const sent = { status: undefined, body: undefined };
  const response = {
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return body;
    },
  };
  const host = {
    switchToHttp() {
      return { getResponse: () => response };
    },
  };

  new StrictTypeErrorFilter().catch(exception, host);

  assert.equal(sent.status, 500);
  assert.equal(sent.body.statusCode, 500);
  assert.equal(sent.body.operation, 'return');
});

test('the Nest error filter returns HTTP 500 for a plain local variable violation (e.g. corrupted data read back from a database)', () => {
  const exception = new StrictTypeError({
    code: 'TYPE_MISMATCH',
    contractKind: 'variable',
    propertyPath: 'entity',
    expected: 'UserEntity',
    received: 'object',
    operation: 'initialize',
  });
  const sent = { status: undefined, body: undefined };
  const response = {
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return body;
    },
  };
  const host = {
    switchToHttp() {
      return { getResponse: () => response };
    },
  };

  new StrictTypeErrorFilter().catch(exception, host);

  assert.equal(sent.status, 500);
  assert.equal(sent.body.statusCode, 500);
  assert.equal(sent.body.contractKind, 'variable');
});

test('the Nest error filter keeps HTTP 400 for a class field (property) violation, e.g. a DTO', () => {
  const exception = new StrictTypeError({
    code: 'TYPE_MISMATCH',
    contractKind: 'property',
    propertyPath: 'CreateUserDto.age',
    expected: 'number',
    received: 'string',
    operation: 'initialize',
  });
  const sent = { status: undefined, body: undefined };
  const response = {
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return body;
    },
  };
  const host = {
    switchToHttp() {
      return { getResponse: () => response };
    },
  };

  new StrictTypeErrorFilter().catch(exception, host);

  assert.equal(sent.status, 400);
});

test('the Nest error filter returns HTTP 500 for a class field violation marked isServerPopulated (e.g. a TypeORM Entity)', () => {
  const exception = new StrictTypeError({
    code: 'TYPE_MISMATCH',
    contractKind: 'property',
    propertyPath: 'UserEntity.role',
    expected: 'UserRole',
    received: 'string',
    operation: 'initialize',
    isServerPopulated: true,
  });
  const sent = { status: undefined, body: undefined };
  const response = {
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return body;
    },
  };
  const host = {
    switchToHttp() {
      return { getResponse: () => response };
    },
  };

  new StrictTypeErrorFilter().catch(exception, host);

  assert.equal(sent.status, 500);
  assert.equal(sent.body.statusCode, 500);
  assert.equal(sent.body.contractKind, 'property');
  assert.equal(Object.hasOwn(sent.body, 'isServerPopulated'), false);
});

test('the Nest error filter uses a field\'s TypeErrorResponse custom message and status', () => {
  const exception = new StrictTypeError({
    code: 'TYPE_MISMATCH',
    contractKind: 'property',
    propertyPath: 'CreateUserDto.email',
    expected: 'string',
    received: 'number',
    operation: 'initialize',
    typeErrorResponseMessage: 'Email inválido',
    typeErrorResponseStatus: 422,
  });
  const sent = { status: undefined, body: undefined };
  const response = {
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return body;
    },
  };
  const host = {
    switchToHttp() {
      return { getResponse: () => response };
    },
  };

  new StrictTypeErrorFilter().catch(exception, host);

  assert.equal(sent.status, 422);
  assert.equal(sent.body.statusCode, 422);
  assert.equal(sent.body.message, 'Email inválido');
  assert.equal(sent.body.code, 'TYPE_MISMATCH');
  assert.equal(sent.body.propertyPath, 'CreateUserDto.email');
  assert.equal(sent.body.expected, 'string');
  assert.equal(sent.body.received, 'number');
  assert.equal(Object.hasOwn(sent.body, 'typeErrorResponseMessage'), false);
  assert.equal(Object.hasOwn(sent.body, 'typeErrorResponseStatus'), false);
});

test('the Nest error filter defaults a TypeErrorResponse without an explicit status to 400', () => {
  const exception = new StrictTypeError({
    code: 'TYPE_MISMATCH',
    contractKind: 'property',
    propertyPath: 'CreateUserDto.email',
    expected: 'string',
    received: 'number',
    operation: 'initialize',
    typeErrorResponseMessage: 'Email inválido',
  });
  const sent = { status: undefined, body: undefined };
  const response = {
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return body;
    },
  };
  const host = {
    switchToHttp() {
      return { getResponse: () => response };
    },
  };

  new StrictTypeErrorFilter().catch(exception, host);

  assert.equal(sent.status, 400);
  assert.equal(sent.body.message, 'Email inválido');
});

test('the Nest error filter lets TypeErrorResponse take priority over isServerPopulated', () => {
  const exception = new StrictTypeError({
    code: 'TYPE_MISMATCH',
    contractKind: 'property',
    propertyPath: 'UserEntity.role',
    expected: 'UserRole',
    received: 'string',
    operation: 'initialize',
    isServerPopulated: true,
    typeErrorResponseMessage: 'Role inválida',
    typeErrorResponseStatus: 422,
  });
  const sent = { status: undefined, body: undefined };
  const response = {
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return body;
    },
  };
  const host = {
    switchToHttp() {
      return { getResponse: () => response };
    },
  };

  new StrictTypeErrorFilter().catch(exception, host);

  assert.equal(sent.status, 422);
  assert.equal(sent.body.message, 'Role inválida');
});

test('StrictTypeHttpError.fromStrictTypeError exposes the same mapping StrictTypeErrorFilter uses internally', () => {
  const exception = new StrictTypeError({
    code: 'TYPE_MISMATCH',
    contractKind: 'return',
    propertyPath: 'UserMapper.toDto.createdAt',
    expected: 'Date',
    received: 'string',
    operation: 'return',
  });

  const httpError = StrictTypeHttpError.fromStrictTypeError(exception);

  assert.ok(httpError instanceof StrictTypeHttpError);
  assert.equal(httpError.getStatus(), 500);
  assert.equal(httpError.cause, exception);
  assert.equal(httpError.getResponse().statusCode, 500);
  assert.equal(httpError.getResponse().code, 'TYPE_MISMATCH');
  assert.equal(httpError.getResponse().propertyPath, 'UserMapper.toDto.createdAt');
});

test('a custom @Catch(StrictTypeError) filter can build on StrictTypeHttpError instead of using StrictTypeErrorFilter', () => {
  const exception = new StrictTypeError({
    code: 'TYPE_MISMATCH',
    contractKind: 'property',
    propertyPath: 'CreateUserDto.email',
    expected: 'string',
    received: 'number',
    operation: 'initialize',
    typeErrorResponseMessage: 'Email inválido',
    typeErrorResponseStatus: 422,
  });

  class MyOwnFilter {
    catch(caught, host) {
      const httpError = StrictTypeHttpError.fromStrictTypeError(caught);
      const response = host.switchToHttp().getResponse();
      // a consumer is free to reshape the body however they like, log it,
      // translate the message, etc. - StrictTypeHttpError just hands them
      // the already-resolved status/message/diagnostic fields to work with.
      response.status(httpError.getStatus()).json({ ok: false, reason: httpError.getResponse().message });
    }
  }

  const sent = { status: undefined, body: undefined };
  const response = {
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return body;
    },
  };
  const host = {
    switchToHttp() {
      return { getResponse: () => response };
    },
  };

  new MyOwnFilter().catch(exception, host);

  assert.equal(sent.status, 422);
  assert.deepEqual(sent.body, { ok: false, reason: 'Email inválido' });
});

test('the Nest error filter returns HTTP 400 for an argument violation, unaffected by B10', () => {
  const exception = new StrictTypeError({
    code: 'TYPE_MISMATCH',
    contractKind: 'parameter',
    propertyPath: 'CreateUserDto.age',
    expected: 'number',
    received: 'string',
    operation: 'argument',
  });
  const sent = { status: undefined, body: undefined };
  const response = {
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return body;
    },
  };
  const host = {
    switchToHttp() {
      return { getResponse: () => response };
    },
  };

  new StrictTypeErrorFilter().catch(exception, host);

  assert.equal(sent.status, 400);
});

test('a real Nest HTTP route returns a 500 for a return-value violation', async (t) => {
  class TestController {
    reject() {
      throw new StrictTypeError({
        code: 'TYPE_MISMATCH',
        contractKind: 'return',
        propertyPath: 'UserMapper.toDto.createdAt',
        expected: 'Date',
        received: 'string',
        operation: 'return',
      });
    }
  }
  Controller('typed')(TestController);
  const descriptor = Object.getOwnPropertyDescriptor(TestController.prototype, 'reject');
  Get('reject')(TestController.prototype, 'reject', descriptor);
  UseFilters(StrictTypeErrorFilter)(TestController.prototype, 'reject', descriptor);

  class TestModule {}
  Module({ controllers: [TestController] })(TestModule);

  const application = await NestFactory.create(TestModule, { logger: false });
  t.after(async () => application.close());
  await application.listen(0, '127.0.0.1');
  const address = application.getHttpServer().address();

  const response = await fetch(`http://127.0.0.1:${address.port}/typed/reject`);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.statusCode, 500);
  assert.equal(body.operation, 'return');
});

test('a real Nest HTTP route returns the safe StrictTypeError response', async (t) => {
  class TestController {
    reject() {
      throw new StrictTypeError({
        code: 'TYPE_MISMATCH',
        contractKind: 'parameter',
        propertyPath: 'CreateUserDto.age',
        expected: 'number',
        received: 'string',
        operation: 'assign',
      });
    }
  }
  Controller('typed')(TestController);
  const descriptor = Object.getOwnPropertyDescriptor(TestController.prototype, 'reject');
  Get('reject')(TestController.prototype, 'reject', descriptor);
  UseFilters(StrictTypeErrorFilter)(TestController.prototype, 'reject', descriptor);

  class TestModule {}
  Module({ controllers: [TestController] })(TestModule);

  const application = await NestFactory.create(TestModule, { logger: false });
  t.after(async () => application.close());
  await application.listen(0, '127.0.0.1');
  const address = application.getHttpServer().address();
  assert.equal(typeof address, 'object');
  assert.notEqual(address, null);

  const response = await fetch(`http://127.0.0.1:${address.port}/typed/reject`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    statusCode: 400,
    message: 'CreateUserDto.age expected number, received string',
    code: 'TYPE_MISMATCH',
    contractKind: 'parameter',
    propertyPath: 'CreateUserDto.age',
    expected: 'number',
    received: 'string',
    operation: 'assign',
  });
});

test('the Nest error filter surfaces every violation for an AggregateStrictTypeError, still as HTTP 400', () => {
  const exception = new AggregateStrictTypeError([
    {
      code: 'TYPE_MISMATCH',
      contractKind: 'parameter',
      propertyPath: 'CreateUserDto.name',
      expected: 'string',
      received: 'number',
      operation: 'argument',
    },
    {
      code: 'TYPE_MISMATCH',
      contractKind: 'parameter',
      propertyPath: 'CreateUserDto.age',
      expected: 'number',
      received: 'string',
      operation: 'argument',
    },
  ]);
  const sent = { status: undefined, body: undefined };
  const response = {
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return body;
    },
  };
  const host = {
    switchToHttp() {
      return { getResponse: () => response };
    },
  };

  new StrictTypeErrorFilter().catch(exception, host);

  assert.equal(sent.status, 400);
  assert.equal(sent.body.errors.length, 2);
  assert.deepEqual(
    sent.body.errors.map((error) => error.propertyPath),
    ['CreateUserDto.name', 'CreateUserDto.age'],
  );
  assert.match(sent.body.message, /Validation failed: 2 error\(s\)/);
});

test('a real Nest HTTP route returns every collected violation for an @AggregateErrors() DTO, still as HTTP 400', async (t) => {
  class TestController {
    reject() {
      throw new AggregateStrictTypeError([
        {
          code: 'TYPE_MISMATCH',
          contractKind: 'parameter',
          propertyPath: 'CreateUserDto.name',
          expected: 'string',
          received: 'number',
          operation: 'argument',
        },
        {
          code: 'TYPE_MISMATCH',
          contractKind: 'parameter',
          propertyPath: 'CreateUserDto.age',
          expected: 'number',
          received: 'string',
          operation: 'argument',
        },
      ]);
    }
  }
  Controller('typed')(TestController);
  const descriptor = Object.getOwnPropertyDescriptor(TestController.prototype, 'reject');
  Get('reject')(TestController.prototype, 'reject', descriptor);
  UseFilters(StrictTypeErrorFilter)(TestController.prototype, 'reject', descriptor);

  class TestModule {}
  Module({ controllers: [TestController] })(TestModule);

  const application = await NestFactory.create(TestModule, { logger: false });
  t.after(async () => application.close());
  await application.listen(0, '127.0.0.1');
  const address = application.getHttpServer().address();

  const response = await fetch(`http://127.0.0.1:${address.port}/typed/reject`);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.errors.length, 2);
  assert.deepEqual(
    body.errors.map((error) => error.propertyPath),
    ['CreateUserDto.name', 'CreateUserDto.age'],
  );
});
