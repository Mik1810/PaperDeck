import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const appDirectory = path.join(process.cwd(), "src/app");
const sourceDirectory = path.join(process.cwd(), "src");
const publicPages = new Set([
  "src/app/sign-in/[[...sign-in]]/page.tsx",
  "src/app/sign-up/[[...sign-up]]/page.tsx",
]);
const verifiedPublicRoutes = new Map([
  ["src/app/api/webhooks/clerk/route.ts", new Set(["verifyWebhook"])],
]);
const authenticationGuards = new Set([
  "requireOwnerId",
  "requireUserContext",
]);
const httpMethods = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression;

function relativePath(filePath: string) {
  return path.relative(process.cwd(), filePath).replaceAll(path.sep, "/");
}

function findFiles(directory: string, fileName: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return findFiles(entryPath, fileName);
    }
    return entry.name === fileName ? [entryPath] : [];
  });
}

function findTypeScriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return findTypeScriptFiles(entryPath);
    }
    return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind) {
  return ts.canHaveModifiers(node)
    ? ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false
    : false;
}

function parseSource(filePath: string) {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function functionsIn(source: ts.SourceFile) {
  const functions = new Map<string, FunctionNode>();

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        functions.set("default", statement);
      }
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
        ) {
          functions.set(declaration.name.text, declaration.initializer);
        }
      }
    }
  }

  return functions;
}

function calledIdentifiers(node: FunctionNode) {
  const calls = new Set<string>();

  function visit(child: ts.Node) {
    if (child !== node && ts.isFunctionLike(child)) {
      return;
    }
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
      calls.add(child.expression.text);
    }
    ts.forEachChild(child, visit);
  }

  visit(node);
  return calls;
}

function reachesGuard(
  functionName: string,
  guards: Set<string>,
  functions: Map<string, FunctionNode>,
  visited = new Set<string>(),
): boolean {
  if (visited.has(functionName)) {
    return false;
  }
  visited.add(functionName);

  const node = functions.get(functionName);
  if (!node) {
    return false;
  }

  const calls = calledIdentifiers(node);
  if ([...calls].some((call) => guards.has(call))) {
    return true;
  }

  return [...calls].some((call) =>
    reachesGuard(call, guards, functions, new Set(visited)),
  );
}

function exportedFunctionNames(source: ts.SourceFile) {
  const names: string[] = [];

  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      names.push(statement.name.text);
    }

    if (
      ts.isVariableStatement(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          names.push(declaration.name.text);
        }
      }
    }
  }

  return names;
}

test("proxy delegates Clerk context without path-based authorization", () => {
  const proxySource = fs.readFileSync(
    path.join(process.cwd(), "src/proxy.ts"),
    "utf8",
  );

  assert.match(proxySource, /\bclerkMiddleware\b/);
  assert.match(proxySource, /\bauthorizedParties\b/);
  assert.doesNotMatch(proxySource, /\bcreateRouteMatcher\b/);
  assert.doesNotMatch(proxySource, /\bauth\.protect\b/);
});

test("every non-public App Router page has a resource-level auth guard", () => {
  const pageFiles = findFiles(appDirectory, "page.tsx");

  for (const filePath of pageFiles) {
    const relative = relativePath(filePath);
    if (publicPages.has(relative)) {
      continue;
    }

    const functions = functionsIn(parseSource(filePath));
    assert.ok(
      reachesGuard("default", authenticationGuards, functions),
      `${relative} must protect its default page export`,
    );
  }
});

test("every Route Handler is authenticated or verifies its public webhook", () => {
  const routeFiles = findFiles(appDirectory, "route.ts");

  for (const filePath of routeFiles) {
    const relative = relativePath(filePath);
    const source = parseSource(filePath);
    const functions = functionsIn(source);
    const routeGuards =
      verifiedPublicRoutes.get(relative) ?? authenticationGuards;
    const handlers = exportedFunctionNames(source).filter((name) =>
      httpMethods.has(name),
    );

    assert.ok(handlers.length > 0, `${relative} must export an HTTP handler`);
    for (const handler of handlers) {
      assert.ok(
        reachesGuard(handler, routeGuards, functions),
        `${relative} ${handler} must authenticate or verify its request`,
      );
    }
  }
});

test("every exported Server Action reaches a resource-level auth guard", () => {
  const actionFiles = findTypeScriptFiles(sourceDirectory).filter((filePath) =>
    parseSource(filePath).statements.some(
      (statement) =>
        ts.isExpressionStatement(statement) &&
        ts.isStringLiteral(statement.expression) &&
        statement.expression.text === "use server",
    ),
  );

  for (const filePath of actionFiles) {
    const relative = relativePath(filePath);
    const source = parseSource(filePath);
    const functions = functionsIn(source);

    for (const action of exportedFunctionNames(source)) {
      assert.ok(
        reachesGuard(action, authenticationGuards, functions),
        `${relative} ${action} must reach an auth guard`,
      );
    }
  }
});
