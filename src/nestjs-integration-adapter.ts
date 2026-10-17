import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import type {
  GlobalErrorFilterSetupResult,
  IntegrationAdapterV1,
  IntegrationContext,
  ProjectResolution,
} from '@ts-typed/compiler';

const API_VERSION = 1 as const;
const NAME = 'nestjs';
const NEST_CLI_FILE = 'nest-cli.json';

interface NestCliConfig {
  readonly sourceRoot?: string;
  readonly compilerOptions?: {
    readonly tsConfigPath?: string;
  };
}

/**
 * Resolves `configPath` from the consumer's `nest-cli.json` when present,
 * preferring Nest's own `compilerOptions.tsConfigPath` (typically
 * `tsconfig.build.json`) over the generic `tsconfig.json` default — mirroring
 * how `nest build`/`nest start` pick their TypeScript configuration. An
 * explicit `context.configPath` (set by the consumer's own `typets.config.json`
 * `tsconfig` option) always takes precedence.
 */
export function resolveProject(context: IntegrationContext): ProjectResolution {
  const resolvedConfigPath = context.configPath ?? resolveNestTsConfigPath(context.projectRoot);
  return {
    apiVersion: API_VERSION,
    integration: NAME,
    projectRoot: context.projectRoot,
    ...(resolvedConfigPath === undefined ? {} : { configPath: resolvedConfigPath }),
  };
}

/**
 * Adds the global filter registration selected by `ts-typed init`. The adapter
 * modifies only a conventional Nest bootstrap containing
 * `const app = await NestFactory.create(...)`; ambiguous projects are left
 * untouched and receive an actionable result message instead.
 */
export function installGlobalStrictTypeErrorFilter(
  context: IntegrationContext,
): GlobalErrorFilterSetupResult {
  const mainPath = resolveNestBootstrapPath(context.projectRoot);
  if (mainPath === undefined || !existsSync(mainPath)) {
    return {
      changed: false,
      message: 'Could not find the Nest bootstrap main.ts; global StrictTypeErrorFilter was not registered.',
    };
  }

  const source = readFileSync(mainPath, 'utf8');
  if (source.includes('StrictTypeErrorFilter') && source.includes('.useGlobalFilters(')) {
    return {
      changed: false,
      message: `StrictTypeErrorFilter is already registered globally in ${relative(context.projectRoot, mainPath)}.`,
    };
  }

  const sourceFile = ts.createSourceFile(mainPath, source, ts.ScriptTarget.Latest, true);
  const bootstrap = findNestBootstrap(sourceFile);
  if (bootstrap === undefined) {
    return {
      changed: false,
      message: `Could not identify a NestFactory.create bootstrap in ${relative(context.projectRoot, mainPath)}; no source file was modified.`,
    };
  }

  const filterCall = `\n${indentationBefore(source, bootstrap.statement.getStart(sourceFile))}${bootstrap.applicationName}.useGlobalFilters(new StrictTypeErrorFilter());`;
  let updated = `${source.slice(0, bootstrap.statement.end)}${filterCall}${source.slice(bootstrap.statement.end)}`;

  if (!hasFilterImport(sourceFile)) {
    const importEnd = lastImportEnd(sourceFile);
    const importStatement = importEnd === 0
      ? "import { StrictTypeErrorFilter } from '@ts-typed/nestjs';\n"
      : "\nimport { StrictTypeErrorFilter } from '@ts-typed/nestjs';\n";
    updated = `${updated.slice(0, importEnd)}${importStatement}${updated.slice(importEnd)}`;
  }

  writeFileSync(mainPath, updated, 'utf8');
  return {
    changed: true,
    message: `Registered StrictTypeErrorFilter globally in ${relative(context.projectRoot, mainPath)}.`,
  };
}

function resolveNestTsConfigPath(projectRoot: string): string | undefined {
  const nestCliPath = join(projectRoot, NEST_CLI_FILE);
  if (!existsSync(nestCliPath)) {
    return undefined;
  }

  const config = readNestCliConfig(nestCliPath);
  const tsConfigPath = config?.compilerOptions?.tsConfigPath;
  return tsConfigPath === undefined ? undefined : join(projectRoot, tsConfigPath);
}

function resolveNestBootstrapPath(projectRoot: string): string | undefined {
  const config = readNestCliConfig(join(projectRoot, NEST_CLI_FILE));
  const sourceRoot = config?.sourceRoot ?? 'src';
  const bootstrapPath = resolve(projectRoot, sourceRoot, 'main.ts');
  const relativePath = relative(projectRoot, bootstrapPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes('../'))
    ? bootstrapPath
    : undefined;
}

function readNestCliConfig(nestCliPath: string): NestCliConfig | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(nestCliPath, 'utf8'));
    return isNestCliConfig(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isNestCliConfig(value: unknown): value is NestCliConfig {
  return typeof value === 'object' && value !== null;
}

interface NestBootstrap {
  readonly applicationName: string;
  readonly statement: ts.VariableStatement;
}

function findNestBootstrap(sourceFile: ts.SourceFile): NestBootstrap | undefined {
  let result: NestBootstrap | undefined;

  const visit = (node: ts.Node): void => {
    if (result !== undefined) {
      return;
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && isNestFactoryCreate(declaration.initializer)) {
          result = { applicationName: declaration.name.text, statement: node };
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return result;
}

function isNestFactoryCreate(initializer: ts.Expression | undefined): boolean {
  if (initializer === undefined || !ts.isAwaitExpression(initializer)) {
    return false;
  }
  const expression = initializer.expression;
  return ts.isCallExpression(expression)
    && ts.isPropertyAccessExpression(expression.expression)
    && ts.isIdentifier(expression.expression.expression)
    && expression.expression.expression.text === 'NestFactory'
    && expression.expression.name.text === 'create';
}

function indentationBefore(source: string, position: number): string {
  const lineStart = source.lastIndexOf('\n', position - 1) + 1;
  const prefix = source.slice(lineStart, position);
  return /^[\t ]*$/.test(prefix) ? prefix : '';
}

function hasFilterImport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return false;
    }
    if (statement.moduleSpecifier.text !== '@ts-typed/nestjs') {
      return false;
    }
    const bindings = statement.importClause?.namedBindings;
    return bindings !== undefined
      && ts.isNamedImports(bindings)
      && bindings.elements.some((element) => element.name.text === 'StrictTypeErrorFilter');
  });
}

function lastImportEnd(sourceFile: ts.SourceFile): number {
  let end = 0;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      end = statement.end;
      continue;
    }
    break;
  }
  return end;
}

export const nestjsIntegrationAdapter: IntegrationAdapterV1 = {
  apiVersion: API_VERSION,
  name: NAME,
  resolveProject,
  installGlobalStrictTypeErrorFilter,
};

export default nestjsIntegrationAdapter;
