# SQL to Prisma Converter

A web application I vibecoded, that converts PostgreSQL SQL schemas to Prisma schema files. Transform your existing database schemas into modern Prisma models with proper relationships, types, and attributes.

## ✨ Features

- **🔄 Real-time Conversion**: Live conversion as you type with 300ms debouncing
- **📝 Dual-Pane Editor**: Monaco Editor with SQL and Prisma syntax highlighting
- **🗄️ Comprehensive SQL Support**:
  - CREATE TABLE statements with all column types
  - CREATE TYPE AS ENUM for custom enums
  - PRIMARY KEY and FOREIGN KEY constraints
  - ALTER TABLE statements for foreign keys
  - Complex relationships and composite keys
- **🎯 Smart Prisma Generation**:
  - Bidirectional relations with proper naming
  - Automatic field mapping (@map, @id, @default)
  - PostgreSQL-specific types (@db.Uuid, @db.JsonB)
  - Proper nullable and optional field handling
- **📋 Copy to Clipboard**: One-click copying of both SQL and Prisma schemas
- **🌙 Dark Mode**: Built-in dark theme optimized for coding
- **📱 Responsive Design**: Works seamlessly on desktop and mobile devices
- **⚡ Fast Performance**: Optimized parsing and generation algorithms

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd sql-prisma

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## 💻 Development

### Available Scripts

```bash
# Development
npm run dev          # Start dev server with hot reload
npm run build        # Build for production
npm run preview      # Preview production build
npm run type-check   # Run TypeScript type checking
```

### Project Structure

```
src/
├── components/ui/   # shadcn/ui component library
├── hooks/          # Custom React hooks
├── lib/            # Utility functions
├── pages/          # Page components
├── services/       # Business logic
│   ├── sql-parser.ts      # SQL parsing engine
│   └── prisma-generator.ts # Prisma schema generator
├── types/          # TypeScript interfaces
└── App.tsx         # Main application component
```

## 🔧 Usage

### Basic Conversion

1. **Input SQL**: Paste your PostgreSQL schema in the left editor
2. **View Output**: See the generated Prisma schema in the right editor
3. **Copy Result**: Click the copy button to copy the Prisma schema

### Example Conversion

**Input SQL:**
```sql
-- Create Users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Posts table
CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT,
  author_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Generated Prisma:**
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  username  String
  createdAt DateTime @default(now()) @map("created_at")

  // Relations
  posts     Post[]

  @@map("users")
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  authorId  Int      @map("author_id")
  createdAt DateTime @default(now()) @map("created_at")

  // Relations
  author    User     @relation(fields: [authorId], references: [id])

  @@map("posts")
}
```

### Supported SQL Features

#### Table Creation
- ✅ CREATE TABLE with all standard PostgreSQL types
- ✅ Column constraints (NOT NULL, UNIQUE, PRIMARY KEY)
- ✅ Default values (including functions like CURRENT_TIMESTAMP)
- ✅ Auto-increment columns (SERIAL, BIGSERIAL)

#### Relationships
- ✅ FOREIGN KEY constraints (inline and ALTER TABLE)
- ✅ Composite foreign keys
- ✅ Self-referencing relationships
- ✅ Many-to-many relationships

#### Advanced Features
- ✅ PostgreSQL enums (CREATE TYPE AS ENUM)
- ✅ JSON/JSONB columns
- ✅ UUID columns with default generation
- ✅ Timestamp columns with auto-update

## 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **UI**: shadcn/ui, Radix UI, Tailwind CSS
- **Editor**: Monaco Editor with custom language support
- **Icons**: Lucide React
- **Build**: Vite with hot module replacement

## 🎨 Customization

### Adding New SQL Types

Extend the type mapping in `src/services/prisma-generator.ts`:

```typescript
private static mapSQLTypeToPrismaType(sqlType: string): string {
  const type = sqlType.toUpperCase();
  switch (type) {
    case 'YOUR_CUSTOM_TYPE':
      return 'String'; // or appropriate Prisma type
    // ... existing cases
  }
}
```

### Custom Prisma Attributes

Modify the field generation logic in `PrismaGenerator.convertColumnToField()` to add custom attributes based on your requirements.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🐛 Known Issues

- Complex CHECK constraints are not yet supported
- Some PostgreSQL-specific functions in DEFAULT values may need manual adjustment
- Materialized views are not supported

## 🔮 Roadmap

- [ ] Support for MySQL and SQLite schemas
- [ ] Import/export schema files
- [ ] Schema validation and error highlighting
- [ ] Batch conversion of multiple schemas
- [ ] Custom field naming conventions
- [ ] Schema visualization

## ❤️ Acknowledgments

- Built with [shadcn/ui](https://ui.shadcn.com/) for beautiful components
- Powered by [Monaco Editor](https://microsoft.github.io/monaco-editor/) for code editing
- Uses [Prisma](https://prisma.io/) schema format specifications
