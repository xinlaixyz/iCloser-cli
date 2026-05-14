// Scanner Worker — worker_threads for parallel regex-based extraction
// Used by scanner.ts to offload CPU-intensive regex operations on large file sets.
// Tree-sitter AST parsing stays in the main thread (native bindings).
import { parentPort } from 'worker_threads';

interface WorkerTask {
  type: 'extract-exports-regex' | 'extract-imports-regex';
  file: string;
  relativeFile: string;
  content: string;
}

if (parentPort) {
  parentPort.on('message', (task: WorkerTask) => {
    let result: { ok: boolean; data?: unknown; error?: string };

    switch (task.type) {
      case 'extract-exports-regex': {
        const exports: Array<{ name: string; kind: string; signature: string; file: string; line: number }> = [];
        const lines = task.content.split('\n');
        const exportRegex = /^export\s+(async\s+)?(function|class|const|interface|type|enum)\s+(\w+)/;
        const tsExportRegex = /^export\s+\{\s*(\w+)/;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          const match = line.match(exportRegex);
          if (match) {
            exports.push({
              name: match[3],
              kind: match[2] === 'enum' ? 'const' : match[2],
              signature: line.substring(0, 100),
              file: task.relativeFile,
              line: i + 1,
            });
          } else {
            const reMatch = line.match(tsExportRegex);
            if (reMatch) {
              const symbols = line.match(/\b(\w+)\b/g)?.slice(1) || [];
              for (const sym of symbols) {
                if (sym !== 'export' && sym !== 'type' && sym !== 'from') {
                  exports.push({ name: sym, kind: 'unknown', signature: line.substring(0, 100), file: task.relativeFile, line: i + 1 });
                }
              }
            }
          }
        }
        result = { ok: true, data: exports };
        break;
      }
      case 'extract-imports-regex': {
        const imports: Array<{ source: string; symbols: string[]; isExternal: boolean }> = [];
        const lines = task.content.split('\n');
        for (const line of lines) {
          const trimLine = line.trim();
          const esMatch = trimLine.match(/^import\s+.*\s+from\s+['"]([^'"]+)['"]/);
          if (esMatch) {
            const source = esMatch[1];
            imports.push({ source, symbols: [], isExternal: !source.startsWith('.') && !source.startsWith('/') });
          }
        }
        result = { ok: true, data: imports };
        break;
      }
      default:
        result = { ok: false, error: `Unknown task type: ${(task as WorkerTask).type}` };
    }

    parentPort!.postMessage(result);
  });
}
