import {
  SQLTable,
  PrismaModel,
  PrismaField,
  SQLParseResult,
  PrismaEnum,
  SQLEnum,
} from "@/types";

export class PrismaGenerator {
  static generatePrismaSchema(parseResult: SQLParseResult): string {
    const enums = this.convertEnumsToPrismaEnums(parseResult.enums);
    const models = this.convertTablesToModels(parseResult.tables, enums);

    const header = `// Generated Prisma schema
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

`;

    const enumsString =
      enums.length > 0
        ? enums.map((enumDef) => this.formatEnum(enumDef)).join("\n\n") + "\n\n"
        : "";
    const modelsString = models
      .map((model) => this.formatModel(model))
      .join("\n\n");

    return header + enumsString + modelsString;
  }

  private static convertTablesToModels(
    tables: SQLTable[],
    enums: PrismaEnum[] = []
  ): PrismaModel[] {
    const models: PrismaModel[] = [];
    const relationCounter = new Map<string, number>();
    const fieldNameCounters = new Map<string, Map<string, number>>();

    // First pass: create basic models with scalar fields only
    for (const table of tables) {
      const model = this.createBasicModel(table, enums);
      models.push(model);
    }

    // Second pass: add relation fields and bidirectional relations
    for (const table of tables) {
      const model = models.find(
        (m) => m.name === this.toPascalCase(table.name)
      )!;

      for (const constraint of table.constraints) {
        if (constraint.type === "FOREIGN KEY" && constraint.referencedTable) {
          // Generate a single relation name for this FK constraint
          const relationName = this.generateUniqueRelationName(
            table.name,
            constraint.referencedTable,
            constraint.columns[0],
            relationCounter
          );

          // Add forward relation to current model
          const relationField = this.createRelationField(
            constraint,
            table,
            relationName,
            fieldNameCounters
          );
          if (relationField) {
            model.fields.push(relationField);
          }

          // Add back-relation to referenced model using the same relation name
          const backRelationField = this.createBackRelationField(
            constraint,
            table,
            relationName,
            fieldNameCounters
          );
          if (backRelationField) {
            const referencedModel = models.find(
              (m) => m.name === this.toPascalCase(constraint.referencedTable!)
            )!;
            if (referencedModel) {
              referencedModel.fields.push(backRelationField);
            }
          }
        }
      }
    }

    return models;
  }

  private static createBasicModel(
    table: SQLTable,
    enums: PrismaEnum[] = []
  ): PrismaModel {
    const modelName = this.toPascalCase(table.name);
    const fields: PrismaField[] = [];

    // Convert columns to scalar fields only
    for (const column of table.columns) {
      const field = this.convertColumnToField(column, table, enums);
      fields.push(field);
    }

    const attributes: string[] = [];
    if (table.name !== modelName.toLowerCase()) {
      attributes.push(`@@map("${table.name}")`);
    }

    return {
      name: modelName,
      fields,
      attributes,
    };
  }

  private static convertColumnToField(
    column: SQLTable["columns"][0],
    _table: SQLTable,
    enums: PrismaEnum[] = []
  ): PrismaField {
    const name = this.toCamelCase(column.name);
    const type = this.mapSQLTypeToPrismaType(
      column.type,
      column.isEnum ? enums : []
    );
    const attributes: string[] = [];

    if (column.isPrimaryKey) {
      if (column.type === "SERIAL" || column.type === "BIGSERIAL") {
        attributes.push("@id @default(autoincrement())");
      } else if (
        column.type === "UUID" &&
        column.defaultValue?.includes("gen_random_uuid")
      ) {
        attributes.push('@id @default(dbgenerated("gen_random_uuid()"))');
      } else {
        attributes.push("@id");
      }
    }

    if (column.isUnique && !column.isPrimaryKey) {
      attributes.push("@unique");
    }

    if (column.defaultValue && !column.isPrimaryKey) {
      const upperDefault = column.defaultValue.toUpperCase();
      if (
        upperDefault === "CURRENT_TIMESTAMP" ||
        upperDefault === "NOW()" ||
        upperDefault === "(NOW())"
      ) {
        attributes.push("@default(now())");
      } else if (column.defaultValue.includes("gen_random_uuid")) {
        attributes.push('@default(dbgenerated("gen_random_uuid()"))');
      } else if (
        column.defaultValue === "true" ||
        column.defaultValue === "false"
      ) {
        attributes.push(`@default(${column.defaultValue})`);
      } else if (!isNaN(Number(column.defaultValue))) {
        attributes.push(`@default(${column.defaultValue})`);
      } else if (
        upperDefault.includes("NOW()") ||
        upperDefault.includes("CURRENT_TIMESTAMP")
      ) {
        attributes.push("@default(now())");
      } else if (
        column.defaultValue.includes("::json") ||
        column.defaultValue.includes("::jsonb")
      ) {
        // Handle PostgreSQL JSON/JSONB type casts with dbgenerated()
        const cleanedValue = column.defaultValue.replace(/^\(|\)$/g, ""); // Remove outer parentheses if present
        attributes.push(`@default(dbgenerated("${cleanedValue}"))`);
      } else {
        attributes.push(`@default("${column.defaultValue}")`);
      }
    }

    if (
      column.type.includes("TIMESTAMP") &&
      column.name.toLowerCase().includes("updated")
    ) {
      attributes.push("@updatedAt");
    }

    if (column.name !== name) {
      attributes.push(`@map("${column.name}")`);
    }

    // Add @db.Uuid for UUID columns in PostgreSQL
    if (column.type === "UUID") {
      attributes.push("@db.Uuid");
    }

    // Add @db.JsonB for JSON/JSONB columns in PostgreSQL
    if (column.type === "JSONB") {
      attributes.push("@db.JsonB");
    } else if (column.type === "JSON") {
      attributes.push("@db.Json");
    }

    // Fixed optionality: FK fields should be optional based on column.nullable only
    return {
      name,
      type,
      attributes,
      isOptional: column.nullable && !column.isPrimaryKey,
      isArray: false,
    };
  }

  private static createRelationField(
    constraint: SQLTable["constraints"][0],
    table: SQLTable,
    relationName: string,
    fieldNameCounters: Map<string, Map<string, number>>
  ): PrismaField | null {
    if (
      !constraint.referencedTable ||
      !constraint.columns.length ||
      !constraint.referencedColumns
    )
      return null;

    const referencedModelName = this.toPascalCase(constraint.referencedTable);
    const fieldName = this.generateUniqueFieldName(
      table.name,
      constraint.referencedTable,
      constraint.columns,
      fieldNameCounters,
      false
    );

    // Support composite foreign keys
    const foreignKeyFields = constraint.columns.map((col) =>
      this.toCamelCase(col)
    );
    const referencedFields = constraint.referencedColumns.map((col) =>
      this.toCamelCase(col)
    );

    return {
      name: fieldName,
      type: referencedModelName,
      attributes: [
        `@relation("${relationName}", fields: [${foreignKeyFields.join(
          ", "
        )}], references: [${referencedFields.join(", ")}])`,
      ],
      isOptional: this.isRelationOptional(constraint, table),
      isArray: false,
    };
  }

  private static createBackRelationField(
    constraint: SQLTable["constraints"][0],
    table: SQLTable,
    relationName: string,
    fieldNameCounters: Map<string, Map<string, number>>
  ): PrismaField | null {
    if (!constraint.referencedTable || !constraint.columns.length) return null;

    const sourceModelName = this.toPascalCase(table.name);
    // If there are multiple FKs from the same source table to the same referenced table,
    // disambiguate the back-relation name using the FK column context, e.g. postsAsAuthor, postsAsCoauthor
    const fkCountToSameTarget = table.constraints.filter(
      (c) =>
        c.type === "FOREIGN KEY" &&
        c.referencedTable === constraint.referencedTable
    ).length;

    const baseBackName = this.pluralize(this.toCamelCase(table.name));
    const needsContext = fkCountToSameTarget > 1;
    const fkContext = this.extractForeignKeyContext(constraint.columns[0]);
    // Use clearer suffix without the "As" infix, e.g. ticketsCreatedBy, ticketsAssignedTo
    const fieldName = needsContext
      ? `${baseBackName}${this.toPascalCase(fkContext)}`
      : baseBackName;

    return {
      name: fieldName,
      type: sourceModelName,
      attributes: [`@relation("${relationName}")`],
      isOptional: false,
      isArray: true,
    };
  }

  private static pluralize(word: string): string {
    // Basic pluralization with guard to avoid double-pluralizing already-plural table names
    const lower = word.toLowerCase();
    // If it already ends with 's' (common for table names), keep as-is
    if (lower.endsWith("s")) return word;
    if (
      lower.endsWith("sh") ||
      lower.endsWith("ch") ||
      lower.endsWith("x") ||
      lower.endsWith("z")
    )
      return word + "es";
    if (lower.endsWith("y") && !/[aeiou]y$/.test(lower))
      return word.slice(0, -1) + "ies";
    return word + "s";
  }

  private static generateUniqueRelationName(
    fromTable: string,
    toTable: string,
    fkColumn: string,
    relationCounter: Map<string, number>
  ): string {
    // Simple base relation name
    const baseName = `${this.toPascalCase(fromTable)}To${this.toPascalCase(
      toTable
    )}`;

    // Track occurrences of this relation pattern
    const count = relationCounter.get(baseName) || 0;
    relationCounter.set(baseName, count + 1);

    // Only add suffix for multiple relations between same tables
    if (count > 0) {
      // Use FK column context for disambiguation
      const fkContext = this.extractForeignKeyContext(fkColumn);
      return `${baseName}_${this.toPascalCase(fkContext)}`;
    }

    return baseName;
  }

  private static generateUniqueFieldName(
    sourceTable: string,
    targetTable: string,
    columns: string[],
    _fieldNameCounters: Map<string, Map<string, number>>,
    isBackRelation: boolean
  ): string {
    const fkColumn = columns[0]; // Primary FK column for naming

    if (isBackRelation) {
      // Kept for compatibility; actual back-relation naming is handled in createBackRelationField
      return this.pluralize(this.toCamelCase(sourceTable));
    } else {
      // For forward relations (many-to-one), extract meaningful name from FK column
      return this.extractRelationFieldName(fkColumn, targetTable);
    }
  }

  private static extractRelationFieldName(
    fkColumn: string,
    targetTable: string
  ): string {
    // Handle reverse FK where the FK column is 'id' (primary key)
    if (fkColumn.toLowerCase() === "id") {
      return this.toCamelCase(targetTable);
    }

    // Remove _id suffix if present
    const columnBase = fkColumn.replace(/_id$/i, "");

    // If the column base matches the target table name, just use the table name
    if (columnBase.toLowerCase() === targetTable.toLowerCase()) {
      return this.toCamelCase(targetTable);
    }

    // Use the column base as the field name (provides better context)
    return this.toCamelCase(columnBase);
  }

  private static extractForeignKeyContext(fkColumn: string): string {
    // Extract meaningful context from FK column name for disambiguation
    // Prefer the last two tokens to keep phrases like created_by, assigned_to
    const cleaned = fkColumn.replace(/_id$/i, "");
    const parts = cleaned.split("_").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}_${parts[parts.length - 1]}`;
    }
    return parts[0] || cleaned;
  }

  private static isRelationOptional(
    constraint: SQLTable["constraints"][0],
    table: SQLTable
  ): boolean {
    // Relation is optional if any of the foreign key columns are nullable
    return constraint.columns.some((colName) => {
      const column = table.columns.find((col) => col.name === colName);
      return column?.nullable || false;
    });
  }

  private static mapSQLTypeToPrismaType(
    sqlType: string,
    enums: PrismaEnum[] = []
  ): string {
    // First check if this is an enum type by comparing with enum names
    const expectedEnumName = this.toPascalCase(sqlType);
    const matchingEnum = enums.find(
      (enumDef) => enumDef.name === expectedEnumName
    );
    if (matchingEnum) {
      return matchingEnum.name;
    }

    const type = sqlType.toUpperCase();

    switch (type) {
      case "SERIAL":
      case "BIGSERIAL":
      case "INTEGER":
      case "INT":
      case "BIGINT":
        return "Int";
      case "VARCHAR":
      case "TEXT":
      case "CHAR":
        return "String";
      case "BOOLEAN":
      case "BOOL":
        return "Boolean";
      case "TIMESTAMP":
      case "TIMESTAMPTZ":
      case "DATE":
      case "TIME":
        return "DateTime";
      case "DECIMAL":
      case "NUMERIC":
      case "FLOAT":
      case "DOUBLE":
      case "REAL":
        return "Float";
      case "UUID":
        return "String";
      case "JSON":
      case "JSONB":
        return "Json";
      default:
        return "String";
    }
  }

  private static formatModel(model: PrismaModel): string {
    let result = `model ${model.name} {\n`;

    // Find the longest field name for alignment
    const maxFieldLength = Math.max(
      ...model.fields.map((field) => field.name.length)
    );
    const maxTypeLength = Math.max(
      ...model.fields
        .map(
          (field) =>
            field.type +
            (field.isOptional ? "?" : "") +
            (field.isArray ? "[]" : "")
        )
        .map((t) => t.length)
    );

    // Separate scalar fields from relation fields
    const scalarFields = model.fields.filter(
      (field) => !this.isRelationField(field)
    );
    const relationFields = model.fields.filter((field) =>
      this.isRelationField(field)
    );

    // Add scalar fields first
    for (const field of scalarFields) {
      const fieldName = field.name.padEnd(maxFieldLength);
      const fieldType = (
        field.type +
        (field.isOptional ? "?" : "") +
        (field.isArray ? "[]" : "")
      ).padEnd(maxTypeLength);
      const attributes = field.attributes.join(" ");

      result += `  ${fieldName} ${fieldType}`;
      if (attributes) {
        result += ` ${attributes}`;
      }
      result += "\n";
    }

    // Add relations with comment separator if there are any
    if (relationFields.length > 0) {
      result += "\n  // Relations\n";
      for (const field of relationFields) {
        const fieldName = field.name.padEnd(maxFieldLength);
        const fieldType = (
          field.type +
          (field.isOptional ? "?" : "") +
          (field.isArray ? "[]" : "")
        ).padEnd(maxTypeLength);
        const attributes = field.attributes.join(" ");

        result += `  ${fieldName} ${fieldType}`;
        if (attributes) {
          result += ` ${attributes}`;
        }
        result += "\n";
      }
    }

    if (model.attributes.length > 0) {
      result += "\n";
      for (const attribute of model.attributes) {
        result += `  ${attribute}\n`;
      }
    }

    result += "}";
    return result;
  }

  private static isRelationField(field: PrismaField): boolean {
    // A field is a relation if it has @relation attribute or is an array of a custom type
    return field.attributes.some((attr) => attr.includes("@relation"));
  }

  private static toPascalCase(str: string): string {
    return str
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join("");
  }

  private static toCamelCase(str: string): string {
    const pascal = this.toPascalCase(str);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
  }

  private static convertEnumsToPrismaEnums(enums: SQLEnum[]): PrismaEnum[] {
    return enums.map((enumDef) => ({
      name: this.toPascalCase(enumDef.name),
      values: enumDef.values,
    }));
  }

  private static formatEnum(enumDef: PrismaEnum): string {
    const values = enumDef.values.map((value) => `  ${value}`).join("\n");
    return `enum ${enumDef.name} {\n${values}\n}`;
  }
}
