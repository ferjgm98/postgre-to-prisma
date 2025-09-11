// SQL parsing types
export interface SQLTable {
  name: string;
  columns: SQLColumn[];
  constraints: SQLConstraint[];
}

export interface SQLEnum {
  name: string;
  values: string[];
}

export interface SQLColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
  isUnique: boolean;
  length?: number;
  isEnum?: boolean;
}

export interface SQLConstraint {
  type: 'PRIMARY KEY' | 'FOREIGN KEY' | 'UNIQUE' | 'CHECK';
  columns: string[];
  referencedTable?: string;
  referencedColumns?: string[];
}

// Prisma generation types
export interface PrismaModel {
  name: string;
  fields: PrismaField[];
  attributes: string[];
}

export interface PrismaEnum {
  name: string;
  values: string[];
}

export interface PrismaField {
  name: string;
  type: string;
  attributes: string[];
  isOptional: boolean;
  isArray: boolean;
}

// Parser result types
export interface SQLParseResult {
  tables: SQLTable[];
  enums: SQLEnum[];
}