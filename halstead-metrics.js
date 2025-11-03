#!/usr/bin/env node

/**
 * Halstead Metrics Calculator
 * 
 * Calculates Halstead metrics for JavaScript/TypeScript files:
 * - Program vocabulary (n = n1 + n2)
 * - Program length (N = N1 + N2)
 * - Calculated length (N^)
 * - Volume (V)
 * - Difficulty (D)
 * - Effort (E)
 * - Time to implement (T)
 * - Number of delivered bugs (B)
 */

const fs = require('fs');
const path = require('path');
const esprima = require('esprima');

// Operators in JavaScript
const OPERATORS = new Set([
  '+', '-', '*', '/', '%', '**', '++', '--',
  '==', '!=', '===', '!==', '<', '>', '<=', '>=',
  '&&', '||', '!', '&', '|', '^', '~', '<<', '>>', '>>>',
  '=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '^=', '|=',
  '?', ':', '...', '=>',
  'typeof', 'instanceof', 'in', 'delete', 'void', 'new',
  '.', '[]', '()', '{}', ',', ';', '/*', '*/', '//'
]);

// Keywords (also operators)
const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'return', 'try', 'catch', 'finally', 'throw',
  'function', 'var', 'let', 'const', 'class', 'extends', 'super',
  'import', 'export', 'from', 'default', 'async', 'await',
  'true', 'false', 'null', 'undefined', 'this', 'yield'
]);

class HalsteadMetrics {
  constructor() {
    this.operators = new Map(); // distinct operators (n1)
    this.operands = new Map();   // distinct operands (n2)
    this.totalOperators = 0;    // total operators (N1)
    this.totalOperands = 0;      // total operands (N2)
  }

  analyzeFile(filePath) {
    try {
      const code = fs.readFileSync(filePath, 'utf8');
      const ast = esprima.parseScript(code, {
        loc: true,
        range: true,
        tokens: true,
        comment: true,
        tolerant: true
      });

      this.analyzeAST(ast, filePath);
    } catch (error) {
      console.error(`Error analyzing ${filePath}:`, error.message);
    }
  }

  analyzeAST(ast, filePath) {
    // Analyze tokens for operators
    if (ast.tokens) {
      ast.tokens.forEach(token => {
        if (OPERATORS.has(token.value) || KEYWORDS.has(token.value)) {
          this.operators.set(token.value, (this.operators.get(token.value) || 0) + 1);
          this.totalOperators++;
        } else if (token.type === 'Identifier' && !KEYWORDS.has(token.value)) {
          this.operands.set(token.value, (this.operands.get(token.value) || 0) + 1);
          this.totalOperands++;
        } else if (token.type === 'String' || token.type === 'Numeric') {
          this.operands.set(token.value, (this.operands.get(token.value) || 0) + 1);
          this.totalOperands++;
        }
      });
    }

    // Traverse AST for more operators
    this.traverse(ast);
  }

  traverse(node) {
    if (!node || typeof node !== 'object') return;

    // Count operators from node types
    if (node.type) {
      const operatorTypes = [
        'BinaryExpression', 'UnaryExpression', 'AssignmentExpression',
        'UpdateExpression', 'LogicalExpression', 'ConditionalExpression',
        'CallExpression', 'NewExpression', 'MemberExpression'
      ];

      if (operatorTypes.includes(node.type)) {
        const op = node.operator || node.type;
        this.operators.set(op, (this.operators.get(op) || 0) + 1);
        this.totalOperators++;
      }
    }

    // Recursively traverse children
    for (const key in node) {
      if (key !== 'parent' && key !== 'leadingComments' && key !== 'trailingComments') {
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(item => this.traverse(item));
        } else if (child && typeof child === 'object') {
          this.traverse(child);
        }
      }
    }
  }

  calculateMetrics() {
    const n1 = this.operators.size; // distinct operators
    const n2 = this.operands.size;  // distinct operands
    const n = n1 + n2;               // program vocabulary

    const N1 = this.totalOperators; // total operators
    const N2 = this.totalOperands;   // total operands
    const N = N1 + N2;               // program length

    // Halstead metrics formulas
    const N_hat = n1 * Math.log2(n1) + n2 * Math.log2(n2); // Calculated length
    const V = N * Math.log2(n);                            // Volume
    const D = (n1 / 2) * (N2 / n2);                        // Difficulty
    const E = D * V;                                        // Effort
    const T = E / 18;                                       // Time (seconds)
    const B = V / 3000;                                     // Bugs estimate

    return {
      n1,           // Distinct operators
      n2,           // Distinct operands
      n,            // Program vocabulary
      N1,           // Total operators
      N2,           // Total operands
      N,            // Program length
      N_hat,        // Calculated length
      V,            // Volume
      D,            // Difficulty
      E,            // Effort
      T,            // Time (seconds)
      B,            // Bugs estimate
      operators: Array.from(this.operators.entries()).sort((a, b) => b[1] - a[1]),
      operands: Array.from(this.operands.entries()).slice(0, 20).sort((a, b) => b[1] - a[1])
    };
  }

  reset() {
    this.operators.clear();
    this.operands.clear();
    this.totalOperators = 0;
    this.totalOperands = 0;
  }
}

function findJSFiles(dir, extensions = ['.js', '.jsx', '.ts', '.tsx']) {
  const files = [];
  
  function traverse(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      // Skip node_modules and build directories
      if (entry.name === 'node_modules' || entry.name === 'build' || entry.name === '.next') {
        continue;
      }
      
      if (entry.isDirectory()) {
        traverse(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }
  
  traverse(dir);
  return files;
}

function formatMetrics(metrics, fileName) {
  return `
╔════════════════════════════════════════════════════════════════╗
║           HALSTEAD METRICS: ${path.basename(fileName).padEnd(35)} ║
╠════════════════════════════════════════════════════════════════╣
║  Basic Metrics:                                                ║
║    • Distinct Operators (n1):        ${metrics.n1.toString().padStart(10)} ║
║    • Distinct Operands (n2):         ${metrics.n2.toString().padStart(10)} ║
║    • Program Vocabulary (n):          ${metrics.n.toString().padStart(10)} ║
║    • Total Operators (N1):             ${metrics.N1.toString().padStart(10)} ║
║    • Total Operands (N2):              ${metrics.N2.toString().padStart(10)} ║
║    • Program Length (N):               ${metrics.N.toString().padStart(10)} ║
║                                                                 ║
║  Derived Metrics:                                              ║
║    • Calculated Length (N^):           ${Math.round(metrics.N_hat).toString().padStart(10)} ║
║    • Volume (V):                       ${Math.round(metrics.V).toString().padStart(10)} ║
║    • Difficulty (D):                   ${Math.round(metrics.D).toString().padStart(10)} ║
║    • Effort (E):                       ${Math.round(metrics.E).toString().padStart(10)} ║
║    • Time to Implement (T):            ${Math.round(metrics.T).toString().padStart(10)} sec ║
║    • Estimated Bugs (B):               ${metrics.B.toFixed(2).padStart(10)} ║
╚════════════════════════════════════════════════════════════════╝
`;
}

function generateReport(files, outputFile = 'halstead-report.txt') {
  const analyzer = new HalsteadMetrics();
  let report = '';
  let totalMetrics = {
    n1: 0, n2: 0, n: 0, N1: 0, N2: 0, N: 0,
    N_hat: 0, V: 0, D: 0, E: 0, T: 0, B: 0
  };

  report += `
╔══════════════════════════════════════════════════════════════════════════════╗
║                    HALSTEAD METRICS ANALYSIS REPORT                          ║
║                    Generated: ${new Date().toLocaleString().padEnd(50)} ║
╚══════════════════════════════════════════════════════════════════════════════╝

`;

  // Analyze each file
  const fileMetrics = [];
  for (const file of files) {
    analyzer.reset();
    analyzer.analyzeFile(file);
    const metrics = analyzer.calculateMetrics();
    fileMetrics.push({ file, metrics });
    
    // Add to totals
    totalMetrics.N1 += metrics.N1;
    totalMetrics.N2 += metrics.N2;
    totalMetrics.N += metrics.N;
    
    report += formatMetrics(metrics, file);
  }

  // Calculate overall metrics
  const overallN1 = new Set();
  const overallN2 = new Set();
  
  fileMetrics.forEach(({ metrics }) => {
    metrics.operators.forEach(([op]) => overallN1.add(op));
    metrics.operands.forEach(([op]) => overallN2.add(op));
  });

  const overallN1Count = overallN1.size;
  const overallN2Count = overallN2.size;
  const overallN = overallN1Count + overallN2Count;
  const overallN_hat = overallN1Count * Math.log2(overallN1Count || 1) + overallN2Count * Math.log2(overallN2Count || 1);
  const overallV = totalMetrics.N * Math.log2(overallN || 1);
  const overallD = (overallN1Count / 2) * (totalMetrics.N2 / (overallN2Count || 1));
  const overallE = overallD * overallV;
  const overallT = overallE / 18;
  const overallB = overallV / 3000;

  report += `
╔════════════════════════════════════════════════════════════════╗
║           OVERALL PROJECT METRICS                              ║
╠════════════════════════════════════════════════════════════════╣
║  Files Analyzed:                ${files.length.toString().padStart(10)} ║
║  Distinct Operators (n1):        ${overallN1Count.toString().padStart(10)} ║
║  Distinct Operands (n2):         ${overallN2Count.toString().padStart(10)} ║
║  Program Vocabulary (n):          ${overallN.toString().padStart(10)} ║
║  Total Operators (N1):             ${totalMetrics.N1.toString().padStart(10)} ║
║  Total Operands (N2):              ${totalMetrics.N2.toString().padStart(10)} ║
║  Program Length (N):               ${totalMetrics.N.toString().padStart(10)} ║
║                                                                 ║
║  Calculated Length (N^):           ${Math.round(overallN_hat).toString().padStart(10)} ║
║  Volume (V):                       ${Math.round(overallV).toString().padStart(10)} ║
║  Difficulty (D):                   ${Math.round(overallD).toString().padStart(10)} ║
║  Effort (E):                       ${Math.round(overallE).toString().padStart(10)} ║
║  Time to Implement (T):            ${Math.round(overallT).toString().padStart(10)} sec ║
║  Estimated Bugs (B):               ${overallB.toFixed(2).padStart(10)} ║
╚════════════════════════════════════════════════════════════════╝

╔════════════════════════════════════════════════════════════════╗
║                        INTERPRETATION                          ║
╠════════════════════════════════════════════════════════════════╣
║  Volume (V):       Higher = more complex code                  ║
║  Difficulty (D):   Higher = harder to maintain                ║
║  Effort (E):       Estimated mental effort required           ║
║  Time (T):         Estimated time in seconds                   ║
║  Bugs (B):         Estimated number of bugs                   ║
╚════════════════════════════════════════════════════════════════╝
`;

  fs.writeFileSync(outputFile, report);
  console.log(report);
  console.log(`\n✅ Report saved to: ${outputFile}`);
  
  return report;
}

// Main execution
const args = process.argv.slice(2);
const targetDir = args[0] || process.cwd();

console.log(`\n🔍 Analyzing files in: ${targetDir}\n`);

// Find all JavaScript/TypeScript files
const serverFiles = findJSFiles(path.join(targetDir, 'server'));
const clientFiles = findJSFiles(path.join(targetDir, 'client/white_board_pranjal/app'));

const allFiles = [...serverFiles, ...clientFiles];

if (allFiles.length === 0) {
  console.log('❌ No JavaScript/TypeScript files found!');
  process.exit(1);
}

console.log(`📁 Found ${allFiles.length} files to analyze:\n`);
allFiles.forEach(file => console.log(`   • ${file}`));

// Generate report
generateReport(allFiles, path.join(targetDir, 'halstead-report.txt'));

