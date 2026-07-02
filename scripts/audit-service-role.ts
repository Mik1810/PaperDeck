import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, "src");

const sourceExtensions = [".ts", ".tsx"] as const;
const ignoredDirectories = new Set([".git", ".next", "node_modules"]);

function toRepoPath(filePath: string) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function walkSourceFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(entryPath));
      continue;
    }

    if (sourceExtensions.some((extension) => entry.name.endsWith(extension))) {
      files.push(entryPath);
    }
  }

  return files;
}

function readSourceFile(filePath: string) {
  const text = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  return { sourceFile, text };
}

function hasDirective(sourceFile: ts.SourceFile, directive: string) {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }

    if (statement.expression.text === directive) {
      return true;
    }
  }

  return false;
}

function hasImport(sourceFile: ts.SourceFile, moduleName: string) {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === moduleName,
  );
}

function importHasRuntimeValue(statement: ts.ImportDeclaration) {
  const importClause = statement.importClause;

  if (!importClause) {
    return true;
  }

  if (importClause.isTypeOnly) {
    return false;
  }

  if (importClause.name) {
    return true;
  }

  const bindings = importClause.namedBindings;

  if (!bindings) {
    return false;
  }

  if (ts.isNamespaceImport(bindings)) {
    return true;
  }

  return bindings.elements.some((specifier) => !specifier.isTypeOnly);
}

function runtimeImportSpecifiers(sourceFile: ts.SourceFile) {
  return sourceFile.statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !importHasRuntimeValue(statement)
    ) {
      return [];
    }

    return [statement.moduleSpecifier.text];
  });
}

function resolveSourceImport(fromFile: string, specifier: string) {
  let basePath: string | null = null;

  if (specifier.startsWith("@/")) {
    basePath = path.join(srcRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    basePath = path.resolve(path.dirname(fromFile), specifier);
  }

  if (!basePath) {
    return null;
  }

  const candidates = [
    basePath,
    ...sourceExtensions.map((extension) => `${basePath}${extension}`),
    ...sourceExtensions.map((extension) =>
      path.join(basePath, `index${extension}`),
    ),
  ];

  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) ?? null;
}

const srcFiles = walkSourceFiles(srcRoot);
const sourceByFile = new Map(srcFiles.map((file) => [file, readSourceFile(file)]));
const serverOnlyFiles = new Set(
  srcFiles.filter((file) => hasImport(sourceByFile.get(file)!.sourceFile, "server-only")),
);
const useServerFiles = new Set(
  srcFiles.filter((file) => hasDirective(sourceByFile.get(file)!.sourceFile, "use server")),
);
const clientFiles = srcFiles.filter((file) =>
  hasDirective(sourceByFile.get(file)!.sourceFile, "use client"),
);

const errors: string[] = [];

const requiredServerOnlyFiles = [
  path.join(srcRoot, "lib", "supabase", "server.ts"),
  path.join(srcRoot, "lib", "auth", "session.ts"),
  ...srcFiles.filter((file) =>
    toRepoPath(file).startsWith("src/lib/repositories/"),
  ),
];

for (const file of requiredServerOnlyFiles) {
  if (!serverOnlyFiles.has(file)) {
    errors.push(`${toRepoPath(file)} must import "server-only".`);
  }
}

for (const [file, { text }] of sourceByFile) {
  if (
    text.includes("SUPABASE_SERVICE_ROLE_KEY") &&
    toRepoPath(file) !== "src/lib/supabase/server.ts"
  ) {
    errors.push(
      `${toRepoPath(file)} references SUPABASE_SERVICE_ROLE_KEY outside the server Supabase client.`,
    );
  }

  if (
    text.includes("createServiceRoleClient") &&
    toRepoPath(file) !== "src/lib/supabase/server.ts" &&
    !serverOnlyFiles.has(file)
  ) {
    errors.push(
      `${toRepoPath(file)} uses createServiceRoleClient without importing "server-only".`,
    );
  }
}

function findClientServerOnlyPaths(clientFile: string) {
  const unsafePaths: string[][] = [];
  const stack: Array<{ file: string; path: string[] }> = [
    { file: clientFile, path: [clientFile] },
  ];
  const visited = new Set<string>();

  while (stack.length) {
    const current = stack.pop()!;

    if (visited.has(current.file)) {
      continue;
    }

    visited.add(current.file);

    if (current.file !== clientFile && serverOnlyFiles.has(current.file)) {
      unsafePaths.push(current.path);
      continue;
    }

    if (current.file !== clientFile && useServerFiles.has(current.file)) {
      continue;
    }

    const source = sourceByFile.get(current.file)?.sourceFile;

    if (!source) {
      continue;
    }

    for (const specifier of runtimeImportSpecifiers(source)) {
      const resolved = resolveSourceImport(current.file, specifier);

      if (resolved) {
        stack.push({
          file: resolved,
          path: [...current.path, resolved],
        });
      }
    }
  }

  return unsafePaths;
}

for (const clientFile of clientFiles) {
  const unsafePaths = findClientServerOnlyPaths(clientFile);

  for (const unsafePath of unsafePaths) {
    errors.push(
      `Client runtime import reaches server-only code: ${unsafePath
        .map(toRepoPath)
        .join(" -> ")}`,
    );
  }
}

if (errors.length) {
  console.error("Service-role audit failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Service-role audit passed:");
console.log(`- checked ${srcFiles.length} src files`);
console.log(`- verified ${requiredServerOnlyFiles.length} server-only modules`);
console.log(`- checked ${clientFiles.length} client component import graphs`);
