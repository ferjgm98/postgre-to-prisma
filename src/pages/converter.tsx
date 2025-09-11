import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { SQLParser } from "@/services/sql-parser";
import { PrismaGenerator } from "@/services/prisma-generator";
import { Database, Layers, Copy, Upload, Download, Settings, HelpCircle, CheckCircle2 } from "lucide-react";
import Editor from "@monaco-editor/react";

// Register Prisma language with Monaco Editor
const registerPrismaLanguage = () => {
  if (typeof window !== 'undefined' && (window as any).monaco) {
    const monaco = (window as any).monaco;
    
    // Register the language
    monaco.languages.register({ id: 'prisma' });
    
    // Define syntax highlighting tokens
    monaco.languages.setMonarchTokensProvider('prisma', {
      tokenizer: {
        root: [
          // Keywords
          [/\b(model|enum|datasource|generator|type)\b/, 'keyword'],
          
          // Data types
          [/\b(String|Int|BigInt|Boolean|DateTime|Float|Decimal|Json|Bytes)\b/, 'type'],
          
          // Decorators/Attributes
          [/@@?\w+(\([^)]*\))?/, 'annotation'],
          
          // Strings
          [/"([^"\\]|\\.)*$/, 'string.invalid'],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*$/, 'string.invalid'],
          [/'([^'\\]|\\.)*'/, 'string'],
          
          // Comments
          [/\/\/.*$/, 'comment'],
          [/\/\*/, 'comment', '@comment'],
          
          // Numbers
          [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
          [/0[xX][0-9a-fA-F]+/, 'number.hex'],
          [/\d+/, 'number'],
          
          // Identifiers
          [/[a-zA-Z_]\w*/, 'identifier'],
          
          // Whitespace and others
          [/[ \t\r\n]+/, 'white'],
          [/[{}()\[\]]/, '@brackets'],
          [/[;,.]/, 'delimiter'],
        ],
        comment: [
          [/[^\/*]+/, 'comment'],
          [/\/\*/, 'comment', '@push'],
          [/\*\//, 'comment', '@pop'],
          [/[\/*]/, 'comment']
        ]
      }
    });
    
    // Define custom theme for Prisma
    monaco.editor.defineTheme('prisma-theme', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: 'C586C0' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'annotation', foreground: 'DCDCAA' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'comment', foreground: '6A9955' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'identifier', foreground: '9CDCFE' }
      ],
      colors: {}
    });
  }
};

const defaultSQL = `-- Create Users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(50) NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Posts table
CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT,
  published BOOLEAN DEFAULT false,
  author_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;

const defaultPrismaContent = `// Generated Prisma schema will appear here

// Try pasting your SQL schema on the left side and see the magic happen!

// Example output:
// generator client {
//   provider = "prisma-client-js"
// }
//
// datasource db {
//   provider = "postgresql"
//   url      = env("DATABASE_URL")
// }
//
// model User {
//   id        Int      @id @default(autoincrement())
//   email     String   @unique
//   username  String
//   password  String
//   createdAt DateTime @default(now()) @map("created_at")
//   updatedAt DateTime @default(now()) @updatedAt @map("updated_at")
//   posts     Post[]
//   
//   @@map("users")
// }
//
// model Post {
//   id        Int      @id @default(autoincrement())
//   title     String
//   content   String?
//   published Boolean  @default(false)
//   authorId  Int      @map("author_id")
//   createdAt DateTime @default(now()) @map("created_at")
//   author    User     @relation(fields: [authorId], references: [id])
//   
//   @@map("posts")
// }`;

export default function Converter() {
  const [sqlInput, setSqlInput] = useState(defaultSQL);
  const [prismaOutput, setPrismaOutput] = useState("");
  const [conversionStatus, setConversionStatus] = useState<"ready" | "converting" | "error">("ready");
  const [tablesConverted, setTablesConverted] = useState(0);
  const [sqlCopied, setSqlCopied] = useState(false);
  const [prismaCopied, setPrismaCopied] = useState(false);
  const { toast } = useToast();

  // Initialize Monaco with Prisma language support
  const handleEditorWillMount = (_monaco: any) => {
    registerPrismaLanguage();
  };


  const convertSQLToPrisma = useCallback((sql: string) => {
    if (!sql.trim()) {
      setPrismaOutput("");
      setTablesConverted(0);
      setConversionStatus("ready");
      return;
    }

    try {
      setConversionStatus("converting");
      
      // Parse SQL and generate Prisma schema
      const parseResult = SQLParser.parseSQL(sql);
      
      if (parseResult.tables.length === 0 && parseResult.enums.length === 0) {
        setConversionStatus("error");
        toast({
          title: "Conversion Error",
          description: "No valid table definitions or enums found in SQL",
          variant: "destructive",
        });
        return;
      }

      const prismaSchema = PrismaGenerator.generatePrismaSchema(parseResult);
      
      setPrismaOutput(prismaSchema);
      setConversionStatus("ready");
      
      // Count number of models and enums in the output
      const modelCount = (prismaSchema.match(/^model\s+\w+/gm) || []).length;
      const enumCount = (prismaSchema.match(/^enum\s+\w+/gm) || []).length;
      setTablesConverted(modelCount + enumCount);
      
    } catch (error) {
      console.error("Conversion error:", error);
      setConversionStatus("error");
      toast({
        title: "Conversion Error",
        description: "An error occurred during conversion. Please check your SQL syntax.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const debouncedConvert = useCallback(
    debounce((sql: string) => {
      convertSQLToPrisma(sql);
    }, 300), // Reduced debounce time since conversion is now instant
    [convertSQLToPrisma]
  );

  useEffect(() => {
    debouncedConvert(sqlInput);
  }, [sqlInput]);

  const handleCopySQL = async () => {
    try {
      await navigator.clipboard.writeText(sqlInput);
      setSqlCopied(true);
      setTimeout(() => setSqlCopied(false), 2000);
      toast({
        title: "Copied!",
        description: "SQL copied to clipboard",
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy SQL to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleCopyPrisma = async () => {
    try {
      await navigator.clipboard.writeText(prismaOutput);
      setPrismaCopied(true);
      setTimeout(() => setPrismaCopied(false), 2000);
      toast({
        title: "Copied!",
        description: "Prisma schema copied to clipboard",
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy Prisma schema to clipboard",
        variant: "destructive",
      });
    }
  };




  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Database className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">SQL to Prisma Converter</h1>
              <p className="text-sm text-muted-foreground">Transform SQL schemas into Prisma models in real-time</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <Button 
              variant="secondary" 
              size="sm"
              data-testid="button-import"
              className="flex items-center space-x-2"
            >
              <Upload className="h-3 w-3" />
              <span>Import SQL</span>
            </Button>
            <Button 
              size="sm"
              data-testid="button-export"
              onClick={handleCopyPrisma}
              disabled={!prismaOutput}
              className="flex items-center space-x-2"
            >
              <Download className="h-3 w-3" />
              <span>Export Schema</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Editor */}
      <div className="editor-container flex">
        {/* SQL Input Panel */}
        <div className="w-1/2 bg-card border-r border-border editor-panel relative">
          <div className="flex items-center justify-between px-4 py-2 bg-muted border-b border-border">
            <div className="flex items-center space-x-2">
              <Database className="h-4 w-4 text-chart-1" />
              <span className="text-sm font-medium">SQL Schema</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              data-testid="button-copy-sql"
              onClick={handleCopySQL}
              className="copy-button px-2 py-1 text-xs bg-accent hover:bg-accent/80 transition-opacity flex items-center space-x-1"
            >
              {sqlCopied ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              <span>{sqlCopied ? 'Copied' : 'Copy'}</span>
            </Button>
          </div>
          
          <div className="editor-content">
            <Editor
              height="100%"
              defaultLanguage="sql"
              value={sqlInput}
              onChange={(value) => setSqlInput(value || "")}
              beforeMount={handleEditorWillMount}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                lineNumbers: "on",
                fontSize: 14,
                fontFamily: "JetBrains Mono, Menlo, monospace",
                tabSize: 2,
                wordWrap: "on",
                automaticLayout: true,
                scrollBeyondLastLine: true,
                scrollBeyondLastColumn: 10,
                padding: { top: 16, bottom: 16 },
                lineHeight: 20,
                cursorStyle: "line",
                renderWhitespace: "selection",
                selectOnLineNumbers: true,
                roundedSelection: false,
                readOnly: false,
                cursorSmoothCaretAnimation: "on",
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                showFoldingControls: "always",
                lineDecorationsWidth: 10,
                lineNumbersMinChars: 3,
                renderLineHighlight: "all",
                renderFinalNewline: "on"
              }}
            />
          </div>
        </div>

        {/* Prisma Output Panel */}
        <div className="w-1/2 bg-card editor-panel relative">
          <div className="flex items-center justify-between px-4 py-2 bg-muted border-b border-border">
            <div className="flex items-center space-x-2">
              <Layers className="h-4 w-4 text-chart-4" />
              <span className="text-sm font-medium">Prisma Schema</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              data-testid="button-copy-prisma"
              onClick={handleCopyPrisma}
              disabled={!prismaOutput}
              className="copy-button px-2 py-1 text-xs bg-accent hover:bg-accent/80 transition-opacity flex items-center space-x-1"
            >
              {prismaCopied ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              <span>{prismaCopied ? 'Copied' : 'Copy'}</span>
            </Button>
          </div>
          
          <div className="editor-content">
            <Editor
              height="100%"
              defaultLanguage="prisma"
              value={prismaOutput || (conversionStatus === "converting" ? "// Converting SQL to Prisma..." : defaultPrismaContent)}
              beforeMount={handleEditorWillMount}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                lineNumbers: "on",
                fontSize: 14,
                fontFamily: "JetBrains Mono, Menlo, monospace",
                tabSize: 2,
                wordWrap: "on",
                automaticLayout: true,
                scrollBeyondLastLine: true,
                scrollBeyondLastColumn: 10,
                padding: { top: 16, bottom: 16 },
                lineHeight: 20,
                cursorStyle: "line",
                renderWhitespace: "selection",
                selectOnLineNumbers: true,
                roundedSelection: false,
                cursorSmoothCaretAnimation: "on",
                contextmenu: true,
                links: false,
                folding: true,
                lineDecorationsWidth: 10,
                lineNumbersMinChars: 3,
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                renderLineHighlight: "all",
                renderFinalNewline: "on"
              }}
            />
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="bg-muted border-t border-border px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1">
            <div className={`w-2 h-2 rounded-full ${
              conversionStatus === "ready" ? "bg-chart-2" :
              conversionStatus === "converting" ? "bg-chart-3 animate-pulse" :
              "bg-destructive"
            }`} />
            <span data-testid="text-status">
              {conversionStatus === "ready" ? "Ready" :
               conversionStatus === "converting" ? "Converting..." :
               "Error"}
            </span>
          </div>
          <div data-testid="text-tables-converted">{tablesConverted} items converted</div>
          <div>PostgreSQL dialect</div>
        </div>
        <div className="flex items-center space-x-4">
          <div>Last converted: {conversionStatus === "converting" ? "converting..." : "now"}</div>
          <Button variant="ghost" size="sm" className="h-auto p-0 hover:text-foreground transition-colors">
            <Settings className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Floating Help Button */}
      <Button
        data-testid="button-help"
        className="fixed bottom-6 right-6 w-12 h-12 rounded-full shadow-lg hover:scale-105 transition-all"
        size="sm"
      >
        <HelpCircle className="h-4 w-4" />
      </Button>
    </div>
  );
}

// Debounce utility function
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
