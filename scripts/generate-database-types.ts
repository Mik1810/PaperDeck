import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type ColumnDefinition = {
  name: string;
  type: string;
  nullable: boolean;
  hasDefault: boolean;
};

type TableDefinition = {
  name: string;
  columns: ColumnDefinition[];
};

type FunctionDefinition = {
  name: string;
  args: Array<{ name: string; type: string; optional: boolean }>;
  returns: Array<{ name: string; type: string }>;
};

const schemaPath = path.join(process.cwd(), "supabase", "schema.sql");
const outputPath = path.join(process.cwd(), "src", "types", "database.ts");
const schemaSql = readFileSync(schemaPath, "utf8");
const checkOnly = process.argv.includes("--check");

function splitTopLevelItems(input: string) {
  const items: string[] = [];
  let current = "";
  let depth = 0;
  let inSingleQuote = false;

  for (const char of input) {
    if (char === "'" && current.at(-1) !== "\\") {
      inSingleQuote = !inSingleQuote;
    }

    if (!inSingleQuote) {
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
      } else if (char === "," && depth === 0) {
        items.push(current.trim());
        current = "";
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) {
    items.push(current.trim());
  }

  return items;
}

function parseEnums() {
  const enums = new Map<string, string[]>();
  const enumPattern = /create\s+type\s+(\w+)\s+as\s+enum\s*\(([\s\S]*?)\);/gi;

  for (const match of schemaSql.matchAll(enumPattern)) {
    const [, enumName, enumBody] = match;
    const values = [...enumBody.matchAll(/'([^']+)'/g)].map((value) => value[1]);
    enums.set(enumName, values);
  }

  return enums;
}

function parseColumn(item: string): ColumnDefinition | null {
  const normalized = item.trim();

  if (
    /^(primary|unique|constraint|foreign|check|exclude)\b/i.test(normalized)
  ) {
    return null;
  }

  const [name] = normalized.split(/\s+/, 1);
  const rest = normalized.slice(name.length).trim();
  const constraintMatch = rest.search(
    /\s(?:not\s+null|null|default|primary\s+key|references|unique|check|generated|collate)\b/i,
  );
  const sqlType =
    constraintMatch === -1 ? rest.trim() : rest.slice(0, constraintMatch).trim();

  return {
    name,
    type: sqlType,
    nullable: !/\bnot\s+null\b/i.test(normalized) && !/\bprimary\s+key\b/i.test(normalized),
    hasDefault: /\bdefault\b/i.test(normalized),
  };
}

function parseTables() {
  const tables: TableDefinition[] = [];
  const tablePattern = /create\s+table\s+(\w+)\s*\(([\s\S]*?)\);/gi;

  for (const match of schemaSql.matchAll(tablePattern)) {
    const [, tableName, tableBody] = match;
    const columns = splitTopLevelItems(tableBody)
      .map(parseColumn)
      .filter((column): column is ColumnDefinition => Boolean(column));

    tables.push({ name: tableName, columns });
  }

  return tables;
}

function parseFunctionArg(item: string, enums: Map<string, string[]>) {
  const normalized = item.trim();
  const [name] = normalized.split(/\s+/, 1);
  const rest = normalized.slice(name.length).trim();
  const defaultMatch = rest.search(/\sdefault\b/i);
  const sqlType =
    defaultMatch === -1 ? rest.trim() : rest.slice(0, defaultMatch).trim();

  return {
    name,
    type: tsTypeForSql(sqlType, enums),
    optional: defaultMatch !== -1,
  };
}

function parseFunctions(enums: Map<string, string[]>) {
  const functions: FunctionDefinition[] = [];
  const functionPattern =
    /create\s+or\s+replace\s+function\s+(\w+)\s*\(([\s\S]*?)\)\s*returns\s+table\s*\(([\s\S]*?)\)\s*language/gi;

  for (const match of schemaSql.matchAll(functionPattern)) {
    const [, functionName, argsBody, returnsBody] = match;
    const args = splitTopLevelItems(argsBody).map((arg) =>
      parseFunctionArg(arg, enums),
    );
    const returns = splitTopLevelItems(returnsBody).map((column) => {
      const [name] = column.trim().split(/\s+/, 1);
      const sqlType = column.trim().slice(name.length).trim();

      return {
        name,
        type: tsTypeForSql(sqlType, enums),
      };
    });

    functions.push({ name: functionName, args, returns });
  }

  return functions;
}

function tsTypeForSql(sqlType: string, enums: Map<string, string[]>) {
  const normalized = sqlType.toLowerCase();

  if (enums.has(normalized)) {
    return `Database["public"]["Enums"]["${normalized}"]`;
  }

  if (normalized.startsWith("text")) {
    return "string";
  }

  if (normalized.startsWith("uuid")) {
    return "string";
  }

  if (normalized.startsWith("integer")) {
    return "number";
  }

  if (normalized.startsWith("real")) {
    return "number";
  }

  if (normalized.startsWith("boolean")) {
    return "boolean";
  }

  if (normalized.startsWith("timestamptz")) {
    return "string";
  }

  if (normalized.startsWith("jsonb")) {
    return "Json";
  }

  if (normalized.startsWith("vector")) {
    return "string | number[]";
  }

  return "unknown";
}

function nullableType(type: string, nullable: boolean) {
  return nullable ? `${type} | null` : type;
}

function renderField(name: string, type: string, indent: string, optional = false) {
  return `${indent}${name}${optional ? "?" : ""}: ${type}`;
}

function renderTable(table: TableDefinition, enums: Map<string, string[]>) {
  const rowFields = table.columns.map((column) =>
    renderField(
      column.name,
      nullableType(tsTypeForSql(column.type, enums), column.nullable),
      "          ",
    ),
  );
  const insertFields = table.columns.map((column) =>
    renderField(
      column.name,
      nullableType(tsTypeForSql(column.type, enums), column.nullable),
      "          ",
      column.nullable || column.hasDefault,
    ),
  );
  const updateFields = table.columns.map((column) =>
    renderField(
      column.name,
      nullableType(tsTypeForSql(column.type, enums), column.nullable),
      "          ",
      true,
    ),
  );

  return [
    `      ${table.name}: {`,
    "        Row: {",
    rowFields.join("\n"),
    "        }",
    "        Insert: {",
    insertFields.join("\n"),
    "        }",
    "        Update: {",
    updateFields.join("\n"),
    "        }",
    "        Relationships: []",
    "      }",
  ].join("\n");
}

function renderFunction(fn: FunctionDefinition) {
  const args = fn.args.length
    ? fn.args
        .map((arg) => renderField(arg.name, arg.type, "          ", arg.optional))
        .join("\n")
    : "          [_ in never]: never";
  const returns = fn.returns
    .map((column) => renderField(column.name, column.type, "          "))
    .join("\n");

  return [
    `      ${fn.name}: {`,
    "        Args: {",
    args,
    "        }",
    "        Returns: Array<{",
    returns,
    "        }>",
    "      }",
  ].join("\n");
}

function renderTypes() {
  const enums = parseEnums();
  const tables = parseTables();
  const functions = parseFunctions(enums);

  const enumEntries = [...enums.entries()].map(([name, values]) => {
    const union = values.map((value) => JSON.stringify(value)).join(" | ");
    return `      ${name}: ${union}`;
  });

  return `// This file is generated by \`npm run db:types\` from supabase/schema.sql.
// Do not edit it manually.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
${tables.map((table) => renderTable(table, enums)).join("\n")}
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
${functions.map(renderFunction).join("\n")}
    }
    Enums: {
${enumEntries.join("\n")}
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
};

type PublicSchema = Database["public"];

export type Tables<TableName extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][TableName]["Row"];

export type TablesInsert<TableName extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][TableName]["Insert"];

export type TablesUpdate<TableName extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][TableName]["Update"];

export type Enums<EnumName extends keyof PublicSchema["Enums"]> =
  PublicSchema["Enums"][EnumName];
`;
}

const generated = renderTypes();

if (checkOnly) {
  const existing = readFileSync(outputPath, "utf8");

  if (existing !== generated) {
    console.error(
      "src/types/database.ts is stale. Run `npm run db:types` and commit the result.",
    );
    process.exit(1);
  }

  console.log("Database types are up to date.");
} else {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, generated);
  console.log(`Generated ${path.relative(process.cwd(), outputPath)}`);
}
