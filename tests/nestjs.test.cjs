const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

require('reflect-metadata');

const { Controller, Get, Module, UseFilters } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { StrictTypeError } = require('@ts-typed/compiler');
const { resolveProject: resolveCoreProject } = require('@ts-typed/compiler/integration');
const {
  nestjsIntegrationAdapter,
  resolveProject,
  StrictTypeErrorFilter,
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
