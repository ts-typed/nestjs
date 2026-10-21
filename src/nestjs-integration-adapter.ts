import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
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
  const sourceFile = ts.createSourceFile(mainPath, source, ts.ScriptTarget.Latest, true);
  const importedLocalName = filterImportLocalName(sourceFile);
  if (importedLocalName !== undefined && hasUseGlobalFiltersCall(sourceFile, importedLocalName)) {
    return {
      changed: false,
      message: `StrictTypeErrorFilter is already registered globally in ${relative(context.projectRoot, mainPath)}.`,
    };
  }

  const bootstrap = findNestBootstrap(sourceFile);
  if (bootstrap === undefined) {
    return {
      changed: false,
      message: `Could not identify a NestFactory.create bootstrap in ${relative(context.projectRoot, mainPath)}; no source file was modified.`,
    };
  }

  const filterCall = `\n${indentationBefore(source, bootstrap.statement.getStart(sourceFile))}${bootstrap.applicationName}.useGlobalFilters(new StrictTypeErrorFilter());`;
  let updated = `${source.slice(0, bootstrap.statement.end)}${filterCall}${source.slice(bootstrap.statement.end)}`;

  if (filterImportLocalName(sourceFile) === undefined) {
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
  return tsConfigPath === undefined
    ? undefined
    : isAbsolute(tsConfigPath)
      ? tsConfigPath
      : join(projectRoot, tsConfigPath);
}

function resolveNestBootstrapPath(projectRoot: string): string | undefined {
  const config = readNestCliConfig(join(projectRoot, NEST_CLI_FILE));
  const sourceRoot = config?.sourceRoot ?? 'src';
  const bootstrapPath = resolve(projectRoot, sourceRoot, 'main.ts');
  const relativePath = relative(projectRoot, bootstrapPath);
  return relativePath === '' || !escapesRoot(relativePath) ? bootstrapPath : undefined;
}

/**
 * Whether `relativePath` (as `relative()` returns it) climbs out of its
 * base directory — a real `..` path SEGMENT, not merely two dots anywhere in
 * the string. A `sourceRoot` naming a directory that itself starts with
 * `..` (e.g. `"..x"`, a legal directory name) must not be mistaken for
 * traversal.
 */
function escapesRoot(relativePath: string): boolean {
  return relativePath.split(sep).some((segment) => segment === '..');
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
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.sourceRoot !== undefined && typeof record.sourceRoot !== 'string') {
    return false;
  }
  if (record.compilerOptions === undefined) {
    return true;
  }
  if (typeof record.compilerOptions !== 'object' || record.compilerOptions === null) {
    return false;
  }
  const tsConfigPath = (record.compilerOptions as Record<string, unknown>).tsConfigPath;
  return tsConfigPath === undefined || typeof tsConfigPath === 'string';
}

interface NestBootstrap {
  readonly applicationName: string;
  readonly statement: ts.VariableStatement;
}

/**
 * Finds the file's `const <app> = await NestFactory.create(...)` bootstrap
 * statement. More than one such statement (for example a conditional
 * test-harness app alongside the real one) is ambiguous — which one actually
 * gets listened on cannot be told apart by this syntactic scan — so this
 * returns `undefined` rather than silently picking whichever one the walk
 * happens to reach first, matching this module's documented "ambiguous
 * projects are left untouched" rule.
 */
function findNestBootstrap(sourceFile: ts.SourceFile): NestBootstrap | undefined {
  const results: NestBootstrap[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && isNestFactoryCreate(declaration.initializer)) {
          results.push({ applicationName: declaration.name.text, statement: node });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return results.length === 1 ? results[0] : undefined;
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

/**
 * The local binding name `StrictTypeErrorFilter` is imported under, honoring
 * a rename (`import { StrictTypeErrorFilter as F }`), or `undefined` if the
 * file has no such import from `@ts-typed/nestjs` yet.
 */
function filterImportLocalName(sourceFile: ts.SourceFile): string | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (statement.moduleSpecifier.text !== '@ts-typed/nestjs') {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) {
      continue;
    }
    const element = bindings.elements.find(
      (candidate) => (candidate.propertyName ?? candidate.name).text === 'StrictTypeErrorFilter',
    );
    if (element !== undefined) {
      return element.name.text;
    }
  }
  return undefined;
}

/**
 * Whether the source already calls `<app>.useGlobalFilters(new <localName>())`
 * anywhere — an AST check (not a text search), so a comment or string
 * mentioning `StrictTypeErrorFilter` can never produce a false positive that
 * skips registering the filter.
 */
function hasUseGlobalFiltersCall(sourceFile: ts.SourceFile, localName: string): boolean {
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'useGlobalFilters' &&
      node.arguments.some(
        (argument) =>
          ts.isNewExpression(argument) &&
          ts.isIdentifier(argument.expression) &&
          argument.expression.text === localName,
      )
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
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
