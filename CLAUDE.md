# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a SQL to Prisma Schema Converter - a React-based web application that converts PostgreSQL SQL schemas to Prisma schema files in real-time. The application features a dual-pane editor interface with Monaco Editor and live conversion.

## Development Commands

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type checking
npm run type-check
```

## Architecture

### Core Application Structure

- **Single Page Application**: Built with React 18 + TypeScript + Vite
- **UI Framework**: shadcn/ui components with Radix UI primitives + Tailwind CSS
- **Editor**: Monaco Editor with custom Prisma language support
- **State Management**: React hooks (useState, useCallback, useEffect) with debounced conversion

### Key Directories

- `src/pages/converter.tsx` - Main converter interface with dual-pane editor
- `src/services/` - Core business logic for SQL parsing and Prisma generation
- `src/types/` - TypeScript interfaces for SQL and Prisma data structures
- `src/components/ui/` - shadcn/ui component library
- `src/hooks/` - Custom React hooks (toast, mobile detection)

### Data Flow Architecture

1. **Input Phase**: User types SQL in left Monaco Editor panel
2. **Parsing Phase**: `SQLParser.parseSQL()` converts SQL to internal AST (`SQLParseResult`)
3. **Generation Phase**: `PrismaGenerator.generatePrismaSchema()` converts AST to Prisma schema string
4. **Output Phase**: Generated schema displayed in right Monaco Editor panel with Prisma syntax highlighting

### Core Services

**SQLParser** (`src/services/sql-parser.ts`):
- Parses CREATE TABLE, CREATE TYPE AS ENUM, ALTER TABLE statements
- Handles quoted/unquoted identifiers, complex constraints, composite foreign keys
- Returns structured data (`SQLTable[]`, `SQLEnum[]`)

**PrismaGenerator** (`src/services/prisma-generator.ts`):
- Converts SQL AST to Prisma models with proper relations
- Handles bidirectional relationships, field naming conventions
- Generates proper Prisma attributes (@id, @relation, @map, etc.)

## Configuration Files

- **Vite**: Uses `@vitejs/plugin-react` with path alias `@` → `./src`
- **TypeScript**: Strict mode enabled with path mapping for `@/*` imports
- **Tailwind**: CSS-in-JS with custom design system using CSS variables
- **shadcn/ui**: Configured with "new-york" style, using component aliases

## Development Patterns

### Component Architecture
- Functional components with TypeScript
- Custom hooks for reusable logic (`use-toast`, `use-mobile`)
- shadcn/ui components for consistent design system

### Monaco Editor Integration
- Custom Prisma language registration with syntax highlighting
- Custom theme for Prisma files (`prisma-theme`)
- Debounced real-time conversion (300ms delay)

### Type Safety
- Comprehensive TypeScript interfaces in `src/types/index.ts`
- Strict type checking enabled with `noUnusedLocals` and `noUnusedParameters`

### Error Handling
- Toast notifications for user feedback
- Graceful error handling in SQL parsing with detailed error messages
- Conversion status tracking (ready/converting/error)

## Key Features Implementation

- **Real-time Conversion**: Debounced input with live preview
- **Syntax Highlighting**: Custom Monaco language for Prisma schemas
- **Copy to Clipboard**: Both SQL and Prisma content can be copied
- **Status Indicators**: Live conversion status and table count
- **Responsive Design**: Mobile-friendly interface with Tailwind CSS

## Testing Approach

No test framework is currently configured. If adding tests, consider:
- Unit tests for SQL parsing logic
- Integration tests for the conversion pipeline
- Component tests for the Monaco Editor integration