import { SQLTable, SQLColumn, SQLConstraint, SQLEnum, SQLParseResult } from "@/types";

export class SQLParser {
  static parseSQL(sql: string): SQLParseResult {
    const tables: SQLTable[] = [];
    const enums: SQLEnum[] = [];
    
    // Clean up the SQL - remove comments and normalize whitespace
    const cleanedSQL = sql
      .replace(/--.*$/gm, '') // Remove line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    // Split by semicolons to get individual statements
    const statements = cleanedSQL.split(';').filter(stmt => stmt.trim());

    // First pass: parse all enums
    for (const statement of statements) {
      const trimmed = statement.trim();
      const upperTrimmed = trimmed.toUpperCase();
      
      if (upperTrimmed.startsWith('CREATE TYPE') && upperTrimmed.includes('AS ENUM')) {
        const enumDef = this.parseCreateEnum(trimmed);
        if (enumDef) {
          enums.push(enumDef);
        }
      }
    }

    // Second pass: parse tables with enum context
    for (const statement of statements) {
      const trimmed = statement.trim();
      const upperTrimmed = trimmed.toUpperCase();
      
      if (upperTrimmed.startsWith('CREATE TABLE')) {
        const table = this.parseCreateTable(trimmed, enums);
        if (table) {
          tables.push(table);
        }
      }
    }

    // Third pass: handle ALTER TABLE statements for foreign keys
    for (const statement of statements) {
      const trimmed = statement.trim();
      const upperTrimmed = trimmed.toUpperCase();
      
      if (upperTrimmed.startsWith('ALTER TABLE') && (upperTrimmed.includes('ADD FOREIGN KEY') || upperTrimmed.includes('ADD CONSTRAINT'))) {
        this.parseAlterTableForeignKey(trimmed, tables);
      }
    }

    return { tables, enums };
  }

  private static parseCreateTable(statement: string, enums: SQLEnum[] = []): SQLTable | null {
    try {
      // Extract table name (handle both quoted and unquoted identifiers)
      const tableNameMatch = statement.match(/CREATE\s+TABLE\s+(?:"([^"]+)"|(\w+))\s*\(/i);
      if (!tableNameMatch) return null;

      const tableName = tableNameMatch[1] || tableNameMatch[2]; // quoted name or unquoted name
      
      // Extract the content between parentheses
      const contentMatch = statement.match(/\(([\s\S]*)\)/);
      if (!contentMatch) return null;

      const content = contentMatch[1];
      
      // Split by commas, but be careful about commas inside parentheses
      const parts = this.splitByCommas(content);
      
      const columns: SQLColumn[] = [];
      const constraints: SQLConstraint[] = [];

      for (const part of parts) {
        const trimmed = part.trim();
        if (this.isConstraintDefinition(trimmed)) {
          const constraint = this.parseConstraint(trimmed);
          if (constraint) {
            constraints.push(constraint);
          }
        } else {
          const column = this.parseColumn(trimmed, {name: tableName, columns, constraints}, enums);
          if (column) {
            columns.push(column);
          }
        }
      }

      return {
        name: tableName,
        columns,
        constraints
      };
    } catch (error) {
      console.error('Error parsing CREATE TABLE statement:', error);
      return null;
    }
  }

  private static splitByCommas(content: string): string[] {
    const parts: string[] = [];
    let current = '';
    let parenthesesDepth = 0;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      
      if (char === '(') {
        parenthesesDepth++;
      } else if (char === ')') {
        parenthesesDepth--;
      } else if (char === ',' && parenthesesDepth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
      
      current += char;
    }
    
    if (current.trim()) {
      parts.push(current.trim());
    }
    
    return parts;
  }

  private static isConstraintDefinition(part: string): boolean {
    const upper = part.toUpperCase();
    // Check if it starts with a column identifier (quoted or unquoted)
    const startsWithColumnIdentifier = /^("([^"]+)"|\w+)\s+/.test(part);
    
    return (
      upper.includes('PRIMARY KEY') ||
      upper.includes('FOREIGN KEY') ||
      upper.includes('UNIQUE') ||
      upper.includes('CHECK')
    ) && !startsWithColumnIdentifier; // Not a column definition
  }

  private static parseIdentifier(identifier: string): string {
    // Handle both quoted and unquoted identifiers
    if (identifier.startsWith('"') && identifier.endsWith('"')) {
      return identifier.slice(1, -1); // Remove quotes
    }
    return identifier;
  }

  private static parseColumn(columnDef: string, table: {name: string, columns: SQLColumn[], constraints: SQLConstraint[]}, enums: SQLEnum[] = []): SQLColumn | null {
    try {
      // Handle quoted column names by parsing the first identifier properly
      const trimmed = columnDef.trim();
      let name: string;
      let remainingDef: string;
      
      if (trimmed.startsWith('"')) {
        // Quoted identifier
        const endQuote = trimmed.indexOf('"', 1);
        if (endQuote === -1) return null;
        name = trimmed.slice(1, endQuote);
        remainingDef = trimmed.slice(endQuote + 1).trim();
      } else {
        // Unquoted identifier
        const spaceIndex = trimmed.indexOf(' ');
        if (spaceIndex === -1) return null;
        name = trimmed.slice(0, spaceIndex);
        remainingDef = trimmed.slice(spaceIndex + 1).trim();
      }
      
      const parts = remainingDef.split(/\s+/);
      if (parts.length < 1) return null;
      
      let type = parts[0];
      
      // Handle types with length like VARCHAR(255)
      let length: number | undefined;
      const lengthMatch = type.match(/(\w+)\((\d+)\)/);
      if (lengthMatch) {
        type = lengthMatch[1];
        length = parseInt(lengthMatch[2]);
      }

      // Check if the type is an enum
      const isEnum = enums.some(enumDef => enumDef.name.toLowerCase() === type.toLowerCase());

      // Parse constraints
      const upperDef = columnDef.toUpperCase();
      const isPrimaryKey = upperDef.includes('PRIMARY KEY');
      const isUnique = upperDef.includes('UNIQUE') || isPrimaryKey;
      const nullable = !upperDef.includes('NOT NULL') && !isPrimaryKey;
      
      // Check for IDENTITY columns (PostgreSQL auto-increment alternative)
      const isIdentity = upperDef.includes('GENERATED BY DEFAULT AS IDENTITY') || 
                        upperDef.includes('GENERATED ALWAYS AS IDENTITY');
      
      // If it's an IDENTITY column, treat it as if it were SERIAL for Prisma conversion
      if (isIdentity && type.toUpperCase() === 'INTEGER') {
        type = 'SERIAL';
      } else if (isIdentity && type.toUpperCase() === 'BIGINT') {
        type = 'BIGSERIAL';
      }
      
      // Extract default value (handle function calls, type casts, and complex expressions)
      let defaultValue: string | undefined;
      const defaultMatch = columnDef.match(/DEFAULT\s+((?:\([^)]*(?:\([^)]*\)[^)]*)*\)(?:::\w+)?)|(?:[^,\s]+))/i);
      if (defaultMatch) {
        defaultValue = defaultMatch[1];
      }

      // Check for inline REFERENCES constraint (handle quoted and unquoted identifiers)
      const referencesMatch = columnDef.match(/REFERENCES\s+(?:"([^"]+)"|(\w+))\s*\(\s*([^)]+)\s*\)/i);
      if (referencesMatch) {
        const referencedTable = referencesMatch[1] || referencesMatch[2]; // quoted or unquoted table name
        const referencedColumns = referencesMatch[3].split(',').map(col => this.parseIdentifier(col.trim()));
        
        // Add the foreign key constraint to the table's constraints
        const foreignKeyConstraint: SQLConstraint = {
          type: 'FOREIGN KEY',
          columns: [name],
          referencedTable,
          referencedColumns
        };
        
        table.constraints.push(foreignKeyConstraint);
      }

      return {
        name,
        type: isEnum ? type : type.toUpperCase(), // Preserve case for enums
        nullable,
        defaultValue,
        isPrimaryKey,
        isUnique,
        length,
        isEnum
      };
    } catch (error) {
      console.error('Error parsing column:', error);
      return null;
    }
  }

  private static parseConstraint(constraintDef: string): SQLConstraint | null {
    try {
      const upper = constraintDef.toUpperCase();
      
      if (upper.includes('PRIMARY KEY')) {
        const columnsMatch = constraintDef.match(/PRIMARY\s+KEY\s*\(\s*([^)]+)\s*\)/i);
        if (columnsMatch) {
          const columns = columnsMatch[1].split(',').map(col => col.trim());
          return {
            type: 'PRIMARY KEY',
            columns
          };
        }
      }
      
      if (upper.includes('FOREIGN KEY')) {
        const fkMatch = constraintDef.match(/FOREIGN\s+KEY\s*\(\s*([^)]+)\s*\)\s*REFERENCES\s+(\w+)\s*\(\s*([^)]+)\s*\)/i);
        if (fkMatch) {
          const columns = fkMatch[1].split(',').map(col => col.trim());
          const referencedTable = fkMatch[2];
          const referencedColumns = fkMatch[3].split(',').map(col => col.trim());
          return {
            type: 'FOREIGN KEY',
            columns,
            referencedTable,
            referencedColumns
          };
        }
      }

      return null;
    } catch (error) {
      console.error('Error parsing constraint:', error);
      return null;
    }
  }

  private static parseCreateEnum(statement: string): SQLEnum | null {
    try {
      // Extract enum name and values from CREATE TYPE ... AS ENUM (...)
      const enumMatch = statement.match(/CREATE\s+TYPE\s+(?:"([^"]+)"|(\w+))\s+AS\s+ENUM\s*\(\s*([^)]+)\s*\)/i);
      if (!enumMatch) return null;

      const enumName = enumMatch[1] || enumMatch[2]; // quoted or unquoted name
      const valuesString = enumMatch[3];

      // Parse enum values (handle quoted values)
      const values = valuesString
        .split(',')
        .map(value => {
          const trimmed = value.trim();
          // Remove quotes if present
          if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || 
              (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
            return trimmed.slice(1, -1);
          }
          return trimmed;
        })
        .filter(value => value.length > 0);

      return {
        name: enumName,
        values
      };
    } catch (error) {
      console.error('Error parsing enum:', error);
      return null;
    }
  }

  private static parseAlterTableForeignKey(statement: string, tables: SQLTable[]): void {
    try {
      // Parse: ALTER TABLE "table_name" ADD [CONSTRAINT "name"] FOREIGN KEY ("column") REFERENCES "referenced_table" ("referenced_column")
      // Note: dbdiagram.io's export format means the FK is actually in the referenced table, not the ALTER TABLE target
      const fkMatch = statement.match(
        /ALTER\s+TABLE\s+(?:"([^"]+)"|(\w+))\s+ADD\s+(?:CONSTRAINT\s+(?:"[^"]+"|[\w]+)\s+)?FOREIGN\s+KEY\s*\(\s*(?:"([^"]+)"|(\w+))\s*\)\s+REFERENCES\s+(?:"([^"]+)"|(\w+))\s*\(\s*(?:"([^"]+)"|(\w+))\s*\)/i
      );
      
      if (!fkMatch) return;

      const alterTableName = fkMatch[1] || fkMatch[2]; // the table being altered (contains the FK column)
      const foreignKeyColumn = fkMatch[3] || fkMatch[4]; // the FK column in the altered table
      const referencedTableName = fkMatch[5] || fkMatch[6]; // the table being referenced
      const referencedColumn = fkMatch[7] || fkMatch[8]; // the referenced column

      // The constraint should be added to the table that contains the foreign key column (the one being altered)
      const foreignKeyTable = tables.find(t => t.name === alterTableName);
      if (foreignKeyTable) {
        const constraint: SQLConstraint = {
          type: 'FOREIGN KEY',
          columns: [foreignKeyColumn],
          referencedTable: referencedTableName,
          referencedColumns: [referencedColumn]
        };
        
        foreignKeyTable.constraints.push(constraint);
      }
    } catch (error) {
      console.error('Error parsing ALTER TABLE FOREIGN KEY:', error);
    }
  }
}