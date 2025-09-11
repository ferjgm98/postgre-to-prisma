import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { SQLParser } from "@/services/sql-parser";
import { PrismaGenerator } from "@/services/prisma-generator";
import {
  Database,
  Layers,
  Copy,
  Upload,
  Download,
  HelpCircle,
  CheckCircle2,
} from "lucide-react";
import Editor from "@monaco-editor/react";

// Register Prisma language with Monaco Editor
const registerPrismaLanguage = () => {
  if (typeof window !== "undefined" && (window as any).monaco) {
    const monaco = (window as any).monaco;

    // Register the language
    monaco.languages.register({ id: "prisma" });

    // Define syntax highlighting tokens
    monaco.languages.setMonarchTokensProvider("prisma", {
      tokenizer: {
        root: [
          // Keywords
          [/\b(model|enum|datasource|generator|type)\b/, "keyword"],

          // Data types
          [
            /\b(String|Int|BigInt|Boolean|DateTime|Float|Decimal|Json|Bytes)\b/,
            "type",
          ],

          // Decorators/Attributes
          [/@@?\w+(\([^)]*\))?/, "annotation"],

          // Strings
          [/"([^"\\]|\\.)*$/, "string.invalid"],
          [/"([^"\\]|\\.)*"/, "string"],
          [/'([^'\\]|\\.)*$/, "string.invalid"],
          [/'([^'\\]|\\.)*'/, "string"],

          // Comments
          [/\/\/.*$/, "comment"],
          [/\/\*/, "comment", "@comment"],

          // Numbers
          [/\d*\.\d+([eE][\-+]?\d+)?/, "number.float"],
          [/0[xX][0-9a-fA-F]+/, "number.hex"],
          [/\d+/, "number"],

          // Identifiers
          [/[a-zA-Z_]\w*/, "identifier"],

          // Whitespace and others
          [/[ \t\r\n]+/, "white"],
          [/[{}()\[\]]/, "@brackets"],
          [/[;,.]/, "delimiter"],
        ],
        comment: [
          [/[^\/*]+/, "comment"],
          [/\/\*/, "comment", "@push"],
          [/\*\//, "comment", "@pop"],
          [/[\/*]/, "comment"],
        ],
      },
    });

    // Define custom theme for Prisma
    monaco.editor.defineTheme("prisma-theme", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "C586C0" },
        { token: "type", foreground: "4EC9B0" },
        { token: "annotation", foreground: "DCDCAA" },
        { token: "string", foreground: "CE9178" },
        { token: "comment", foreground: "6A9955" },
        { token: "number", foreground: "B5CEA8" },
        { token: "identifier", foreground: "9CDCFE" },
      ],
      colors: {},
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
  const [conversionStatus, setConversionStatus] = useState<
    "ready" | "converting" | "error"
  >("ready");
  const [tablesConverted, setTablesConverted] = useState(0);
  const [sqlCopied, setSqlCopied] = useState(false);
  const [prismaCopied, setPrismaCopied] = useState(false);
  const [isHelpDialogOpen, setIsHelpDialogOpen] = useState(false);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sqlEditorRef = useRef<any>(null);
  const prismaEditorRef = useRef<any>(null);
  const isModifierPressedRef = useRef(false);
  const sqlInputRef = useRef(sqlInput);
  const currentDecorationsRef = useRef<string[]>([]);

  // Initialize Monaco with Prisma language support
  const handleEditorWillMount = (_monaco: any) => {
    registerPrismaLanguage();
  };

  // Extract navigable entities (tables and enums) from SQL content
  const getSQLEntitiesFromSQL = (sql: string): Set<string> => {
    const entityNames = new Set<string>();
    
    // Match CREATE TABLE statements
    const createTableRegex =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"]?)([a-zA-Z_][\w]*)\1/gi;
    let match;
    while ((match = createTableRegex.exec(sql)) !== null) {
      entityNames.add(match[2].toLowerCase());
    }
    
    // Match CREATE TYPE ... AS ENUM statements
    const createTypeRegex =
      /CREATE\s+TYPE\s+([`"]?)([a-zA-Z_][\w]*)\1\s+AS\s+ENUM/gi;
    while ((match = createTypeRegex.exec(sql)) !== null) {
      entityNames.add(match[2].toLowerCase());
    }

    return entityNames;
  };

  // Enhanced word detection that handles quoted identifiers and underscores
  const getWordAtPosition = (editor: any, position: any) => {
    const model = editor.getModel();
    if (!model) return null;

    // Get the line content
    const lineContent = model.getLineContent(position.lineNumber);
    const offset = position.column - 1;

    // First try Monaco's built-in method
    const monacoWord = model.getWordAtPosition(position);

    // If Monaco found a word with underscores, use it
    if (monacoWord && monacoWord.word.includes("_")) {
      return monacoWord;
    }

    // Fallback: manually extract the full identifier including underscores
    // Look for quoted or unquoted SQL identifiers
    const identifierRegex = /(["`']?)([a-zA-Z_][\w]*)\1/g;
    let match;

    while ((match = identifierRegex.exec(lineContent)) !== null) {
      const start = match.index + match[1].length; // After opening quote
      const end = start + match[2].length; // Before closing quote

      if (offset >= start && offset < end) {
        return {
          word: match[2], // The identifier without quotes
          startColumn: start + 1, // Monaco uses 1-based columns
          endColumn: end + 1,
        };
      }
    }

    // If nothing else worked, return Monaco's result
    return monacoWord;
  };

  // Handle SQL editor mount
  const handleSqlEditorMount = (editor: any, monaco: any) => {
    sqlEditorRef.current = editor;
    
    // Configure word pattern for SQL to include underscores
    monaco.languages.setLanguageConfiguration("sql", {
      wordPattern: /[a-zA-Z_][\w]*/,
    });

    // Handle mouse move for hover effects
    editor.onMouseMove((e: any) => {
      if (!isModifierPressedRef.current) {
        // Clear decorations if no modifier is pressed
        if (currentDecorationsRef.current.length > 0) {
          editor.deltaDecorations(currentDecorationsRef.current, []);
          currentDecorationsRef.current = [];
        }
        return;
      }

      const position = e.target.position;
      if (position) {
        const word = getWordAtPosition(editor, position);
        if (word) {
          const selectedText = word.word.toLowerCase();
          const entityNames = getSQLEntitiesFromSQL(sqlInputRef.current);

          if (entityNames.has(selectedText)) {
            // Add hover decoration
            const decorations = editor.deltaDecorations(
              currentDecorationsRef.current,
              [
                {
                  range: {
                    startLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endLineNumber: position.lineNumber,
                    endColumn: word.endColumn,
                  },
                  options: {
                    className: "table-hover-highlight",
                    hoverMessage: {
                      value: `${navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+click to navigate to ${sqlToPrismaName(selectedText)} model`,
                    },
                  },
                },
              ],
            );
            currentDecorationsRef.current = decorations;
          } else {
            // Clear decorations when hovering over non-table words
            if (currentDecorationsRef.current.length > 0) {
              editor.deltaDecorations(currentDecorationsRef.current, []);
              currentDecorationsRef.current = [];
            }
          }
        } else {
          // Clear decorations when not hovering over a word
          if (currentDecorationsRef.current.length > 0) {
            editor.deltaDecorations(currentDecorationsRef.current, []);
            currentDecorationsRef.current = [];
          }
        }
      }
    });

    // Handle clicks with onMouseUp for better Monaco compatibility
    editor.onMouseUp((e: any) => {
      if ((e.event.metaKey || e.event.ctrlKey) && e.target.position) {
        const word = getWordAtPosition(editor, e.target.position);
        if (word) {
          const selectedText = word.word.toLowerCase();
          const entityNames = getSQLEntitiesFromSQL(sqlInputRef.current);

          if (entityNames.has(selectedText)) {
            e.event.preventDefault();
            e.event.stopPropagation();

            // Small delay to ensure the event is processed
            setTimeout(() => {
              navigateToPrismaModel(selectedText);
            }, 50);
          }
        }
      }
    });
  };

  // Handle Prisma editor mount
  const handlePrismaEditorMount = (editor: any, _monaco: any) => {
    prismaEditorRef.current = editor;
  };

  const convertSQLToPrisma = useCallback(
    (sql: string) => {
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
          description:
            "An error occurred during conversion. Please check your SQL syntax.",
          variant: "destructive",
        });
      }
    },
    [toast],
  );

  const debouncedConvert = useCallback(
    debounce((sql: string) => {
      convertSQLToPrisma(sql);
    }, 300), // Reduced debounce time since conversion is now instant
    [convertSQLToPrisma],
  );

  useEffect(() => {
    debouncedConvert(sqlInput);
    // Keep ref in sync with state
    sqlInputRef.current = sqlInput;
  }, [sqlInput]);

  // Monitor prismaOutput changes for debugging
  useEffect(() => {}, [prismaOutput]);

  // Global modifier key tracking
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        isModifierPressedRef.current = true;
      }
    };

    const handleGlobalKeyUp = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) {
        isModifierPressedRef.current = false;
        // Clear decorations when modifier is released globally
        if (sqlEditorRef.current && currentDecorationsRef.current.length > 0) {
          sqlEditorRef.current.deltaDecorations(
            currentDecorationsRef.current,
            [],
          );
          currentDecorationsRef.current = [];
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    window.addEventListener("keyup", handleGlobalKeyUp);

    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      window.removeEventListener("keyup", handleGlobalKeyUp);
    };
  }, []);

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

  const handleImportSQL = () => {
    fileInputRef.current?.click();
  };

  const handleExportSchema = () => {
    if (!prismaOutput) return;

    try {
      // Create a blob with the Prisma schema content
      const blob = new Blob([prismaOutput], { type: "text/plain" });

      // Generate filename with timestamp
      const now = new Date();
      const timestamp = now
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\..+/, "")
        .replace("T", "_");
      const filename = `schema_${timestamp}.prisma`;

      // Create download link and trigger download
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();

      // Clean up
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Schema Exported",
        description: `Successfully exported ${filename}`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export the schema file",
        variant: "destructive",
      });
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".sql")) {
      toast({
        title: "Invalid File Type",
        description: "Please select a .sql file",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        setSqlInput(content);
        toast({
          title: "File Imported",
          description: `Successfully imported ${file.name}`,
        });
      }
    };

    reader.onerror = () => {
      toast({
        title: "Import Failed",
        description: "Failed to read the file",
        variant: "destructive",
      });
    };

    reader.readAsText(file);

    // Reset the input so the same file can be selected again
    event.target.value = "";
  };

  // Convert SQL entity name to Prisma name (model or enum)
  const sqlToPrismaName = (sqlName: string): string => {
    // Remove quotes if present
    const cleanName = sqlName.replace(/["`']/g, "");

    // Convert snake_case to PascalCase
    let result = cleanName
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join("");

    // Check if this is likely an enum (contains common enum patterns or suffixes)
    const isLikelyEnum =
      /(_status|_type|_state|_category|_level|_role|_kind)$/i.test(cleanName) ||
      /^(status|type|state|category|level|role|kind)/i.test(cleanName);

    // Only singularize if it's likely a table (not an enum)
    if (!isLikelyEnum) {
      // Better singularization for tables
      if (result.endsWith("ies")) {
        result = result.slice(0, -3) + "y"; // companies -> Company
      } else if (result.endsWith("es") && !result.endsWith("ses")) {
        result = result.slice(0, -2); // boxes -> Box, but not buses -> Bu
      } else if (result.endsWith("s") && !result.endsWith("ss")) {
        result = result.slice(0, -1); // users -> User, but not class -> Clas
      }
    }

    return result;
  };

  // Navigate to corresponding Prisma model
  const navigateToPrismaModel = (sqlTableName: string) => {
    if (!prismaEditorRef.current) {
      toast({
        title: "Navigation Error",
        description: "Prisma editor not ready",
        variant: "destructive",
      });
      return;
    }

    // Get the actual content from the editor instead of using React state
    const prismaEditor = prismaEditorRef.current;
    const model = prismaEditor.getModel();

    if (!model) {
      toast({
        title: "Navigation Error",
        description: "Prisma editor model not available",
        variant: "destructive",
      });
      return;
    }

    const editorContent = model.getValue();

    if (!editorContent || editorContent.trim().length === 0) {
      toast({
        title: "No Prisma Schema",
        description:
          "Please wait for SQL to be converted to Prisma schema first",
        variant: "destructive",
      });
      return;
    }

    const modelName = sqlToPrismaName(sqlTableName);

    try {
      // Focus the Prisma editor first
      prismaEditor.focus();

      // Try multiple search patterns to find the model or enum
      const searchPatterns = [
        `model ${modelName}`, // Try as a model first
        `enum ${modelName}`, // Try as an enum
        `model ${modelName.toLowerCase()}`,
        `enum ${modelName.toLowerCase()}`,
        modelName, // Just the entity name
        `${modelName} {`, // Entity name with opening brace
      ];

      let matches: any[] = [];

      for (const pattern of searchPatterns) {
        matches = model.findMatches(
          pattern,
          false, // not regex
          false, // not case sensitive
          false, // not whole word
          null,
          true, // return all matches
        );

        if (matches.length > 0) {
          break;
        }
      }

      if (matches.length > 0) {
        const match = matches[0];
        const startLine = match.range.startLineNumber;

        // Simple scroll to the line
        prismaEditor.revealLineInCenter(startLine);

        // Set cursor position to the found line
        prismaEditor.setPosition({
          lineNumber: startLine,
          column: 1,
        });

        // Simple selection of just the line
        prismaEditor.setSelection({
          startLineNumber: startLine,
          startColumn: 1,
          endLineNumber: startLine,
          endColumn: model.getLineMaxColumn(startLine),
        });

        toast({
          title: "Navigated to Model",
          description: `Found ${modelName} model in Prisma schema`,
        });
      } else {
        toast({
          title: "Model Not Found",
          description: `Could not find model ${modelName} in Prisma schema`,
          variant: "destructive",
        });
      }
      
    } catch (error) {
      console.error("Error during navigation:", error);
      toast({
        title: "Navigation Error",
        description: "An error occurred while navigating to the model",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".sql"
        style={{ display: "none" }}
      />
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Database className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                SQL to Prisma Converter
              </h1>
              <p className="text-sm text-muted-foreground">
                Transform SQL schemas into Prisma models in real-time
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <Button
              variant="secondary"
              size="sm"
              data-testid="button-import"
              onClick={handleImportSQL}
              className="flex items-center space-x-2"
            >
              <Upload className="h-3 w-3" />
              <span>Import SQL</span>
            </Button>
            <Button
              size="sm"
              data-testid="button-export"
              onClick={handleExportSchema}
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
              className="px-2 py-1 text-xs flex items-center space-x-1"
            >
              {sqlCopied ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              <span>{sqlCopied ? "Copied" : "Copy"}</span>
            </Button>
          </div>

          <div className="editor-content">
            <Editor
              height="100%"
              defaultLanguage="sql"
              value={sqlInput}
              onChange={(value) => setSqlInput(value || "")}
              beforeMount={handleEditorWillMount}
              onMount={handleSqlEditorMount}
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
                renderFinalNewline: "on",
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
              className="px-2 py-1 text-xs flex items-center space-x-1"
            >
              {prismaCopied ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              <span>{prismaCopied ? "Copied" : "Copy"}</span>
            </Button>
          </div>

          <div className="editor-content">
            <Editor
              height="100%"
              defaultLanguage="prisma"
              value={
                prismaOutput ||
                (conversionStatus === "converting"
                  ? "// Converting SQL to Prisma..."
                  : defaultPrismaContent)
              }
              beforeMount={handleEditorWillMount}
              onMount={handlePrismaEditorMount}
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
                renderFinalNewline: "on",
              }}
            />
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="bg-muted border-t border-border px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1">
            <div
              className={`w-2 h-2 rounded-full ${
                conversionStatus === "ready"
                  ? "bg-chart-2"
                  : conversionStatus === "converting"
                    ? "bg-chart-3 animate-pulse"
                    : "bg-destructive"
              }`}
            />
            <span data-testid="text-status">
              {conversionStatus === "ready"
                ? "Ready"
                : conversionStatus === "converting"
                  ? "Converting..."
                  : "Error"}
            </span>
          </div>
          <div data-testid="text-tables-converted">
            {tablesConverted} items converted
          </div>
          <div>PostgreSQL dialect</div>
        </div>
        <div className="flex items-center space-x-4">
          <div>
            Last converted:{" "}
            {conversionStatus === "converting" ? "converting..." : "now"}
          </div>
        </div>
      </div>

      {/* Floating Help Button */}
      <Dialog open={isHelpDialogOpen} onOpenChange={setIsHelpDialogOpen}>
        <DialogTrigger asChild>
          <Button
            data-testid="button-help"
            className="fixed bottom-6 right-6 w-12 h-12 rounded-full shadow-lg hover:scale-105 transition-all"
            size="sm"
          >
            <HelpCircle className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <HelpCircle className="h-5 w-5" />
              <span>SQL to Prisma Converter - Help</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Overview */}
            <div>
              <h3 className="text-lg font-semibold mb-2">Overview</h3>
              <p className="text-muted-foreground">
                This tool converts PostgreSQL SQL schemas to Prisma schema files
                in real-time. Simply paste or type your SQL schema in the left
                panel and see the converted Prisma schema on the right.
              </p>
            </div>

            {/* Keyboard Shortcuts */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Keyboard Shortcuts</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 bg-muted rounded">
                  <span>Navigate to Prisma model</span>
                  <kbd className="px-2 py-1 text-xs bg-background border rounded">
                    {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} + Click
                  </kbd>
                </div>
                <div className="flex items-center justify-between p-2 bg-muted rounded">
                  <span>Copy SQL content</span>
                  <kbd className="px-2 py-1 text-xs bg-background border rounded">
                    Click Copy button
                  </kbd>
                </div>
                <div className="flex items-center justify-between p-2 bg-muted rounded">
                  <span>Copy Prisma schema</span>
                  <kbd className="px-2 py-1 text-xs bg-background border rounded">
                    Click Copy button
                  </kbd>
                </div>
              </div>
            </div>

            {/* Features */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Features</h3>
              <ul className="space-y-2 text-muted-foreground">
                <li className="flex items-start space-x-2">
                  <span className="text-chart-2 mt-1">•</span>
                  <span>
                    <strong>Real-time conversion:</strong> See changes instantly
                    as you type
                  </span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-chart-2 mt-1">•</span>
                  <span>
                    <strong>Smart navigation:</strong> Cmd/Ctrl+Click on table
                    names in SQL to jump to corresponding Prisma models
                  </span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-chart-2 mt-1">•</span>
                  <span>
                    <strong>Import/Export:</strong> Import SQL files and export
                    generated Prisma schemas
                  </span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-chart-2 mt-1">•</span>
                  <span>
                    <strong>Syntax highlighting:</strong> Full syntax
                    highlighting for both SQL and Prisma
                  </span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-chart-2 mt-1">•</span>
                  <span>
                    <strong>Relationship detection:</strong> Automatically
                    generates bidirectional relationships
                  </span>
                </li>
              </ul>
            </div>

            {/* Supported SQL Features */}
            <div>
              <h3 className="text-lg font-semibold mb-3">
                Supported SQL Features
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <h4 className="font-medium mb-2">Tables & Columns</h4>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>• CREATE TABLE statements</li>
                    <li>• Primary keys (SERIAL, UUID)</li>
                    <li>• Foreign key constraints</li>
                    <li>• NOT NULL constraints</li>
                    <li>• DEFAULT values</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Data Types</h4>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>• INTEGER, SERIAL, BIGINT</li>
                    <li>• VARCHAR, TEXT</li>
                    <li>• BOOLEAN</li>
                    <li>• TIMESTAMP, DATE</li>
                    <li>• DECIMAL, NUMERIC</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Tips */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Tips</h3>
              <ul className="space-y-2 text-muted-foreground text-sm">
                <li className="flex items-start space-x-2">
                  <span className="text-chart-3 mt-1">💡</span>
                  <span>
                    Table names will be converted to PascalCase and singularized
                    (e.g., <code className="bg-muted px-1 rounded">users</code>{" "}
                    → <code className="bg-muted px-1 rounded">User</code>)
                  </span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-chart-3 mt-1">💡</span>
                  <span>
                    Column names will be converted to camelCase (e.g.,{" "}
                    <code className="bg-muted px-1 rounded">created_at</code> →{" "}
                    <code className="bg-muted px-1 rounded">createdAt</code>)
                  </span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-chart-3 mt-1">💡</span>
                  <span>
                    Use the status bar to monitor conversion progress and see
                    how many items were converted
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Debounce utility function
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
