#!/usr/bin/env node

/**
 * Information Metrics Calculator
 * 
 * Calculates various information metrics for code analysis:
 * - Lines of Code (LOC)
 * - Number of Functions/Classes
 * - Cyclomatic Complexity
 * - Maintainability Index
 * - Information Content
 * - Code Structure Metrics
 * - Dependency Analysis
 */

const fs = require('fs');
const path = require('path');
const esprima = require('esprima');

class InformationMetrics {
  constructor() {
    this.files = [];
    this.functions = [];
    this.classes = [];
    this.imports = [];
    this.exports = [];
  }

  analyzeFile(filePath) {
    try {
      const code = fs.readFileSync(filePath, 'utf8');
      const fileInfo = {
        path: filePath,
        name: path.basename(filePath),
        linesOfCode: this.countLines(code),
        linesOfComments: this.countComments(code),
        linesBlank: this.countBlankLines(code),
        cyclomaticComplexity: 0,
        functions: [],
        classes: [],
        imports: [],
        exports: [],
        dependencies: [],
        maxNesting: 0,
        maintainabilityIndex: 0
      };

      const ast = esprima.parseScript(code, {
        loc: true,
        range: true,
        tolerant: true,
        sourceType: 'module'
      });

      this.analyzeAST(ast, fileInfo);
      this.files.push(fileInfo);
    } catch (error) {
      console.error(`Error analyzing ${filePath}:`, error.message);
    }
  }

  countLines(code) {
    return code.split('\n').length;
  }

  countComments(code) {
    const singleLineComments = (code.match(/\/\/.*/g) || []).length;
    const multiLineComments = (code.match(/\/\*[\s\S]*?\*\//g) || []).length;
    return singleLineComments + multiLineComments;
  }

  countBlankLines(code) {
    return (code.match(/^\s*$/gm) || []).length;
  }

  analyzeAST(ast, fileInfo) {
    let maxComplexity = 1;
    let maxNesting = 0;

    const traverse = (node, depth = 0, complexity = 1) => {
      if (!node || typeof node !== 'object') return complexity;

      maxNesting = Math.max(maxNesting, depth);

      // Count complexity-increasing constructs
      const complexityNodes = [
        'IfStatement', 'ForStatement', 'WhileStatement', 'DoWhileStatement',
        'SwitchStatement', 'CatchClause', 'ConditionalExpression',
        'LogicalExpression', 'ForInStatement', 'ForOfStatement'
      ];

      if (complexityNodes.includes(node.type)) {
        complexity++;
        maxComplexity = Math.max(maxComplexity, complexity);
      }

      // Extract functions
      if (node.type === 'FunctionDeclaration' || 
          node.type === 'FunctionExpression' ||
          node.type === 'ArrowFunctionExpression') {
        const funcInfo = {
          name: node.id ? node.id.name : 'anonymous',
          type: node.type,
          line: node.loc ? node.loc.start.line : 0,
          params: node.params ? node.params.length : 0,
          complexity: complexity,
          length: node.loc ? node.loc.end.line - node.loc.start.line : 0
        };
        fileInfo.functions.push(funcInfo);
        this.functions.push({ ...funcInfo, file: fileInfo.name });
      }

      // Extract classes
      if (node.type === 'ClassDeclaration') {
        const classInfo = {
          name: node.id ? node.id.name : 'anonymous',
          line: node.loc ? node.loc.start.line : 0,
          methods: node.body ? node.body.body.filter(m => m.type === 'MethodDefinition').length : 0,
          length: node.loc ? node.loc.end.line - node.loc.start.line : 0
        };
        fileInfo.classes.push(classInfo);
        this.classes.push({ ...classInfo, file: fileInfo.name });
      }

      // Extract imports
      if (node.type === 'ImportDeclaration') {
        const importInfo = {
          source: node.source ? node.source.value : '',
          specifiers: node.specifiers ? node.specifiers.length : 0
        };
        fileInfo.imports.push(importInfo);
        this.imports.push({ ...importInfo, file: fileInfo.name });
      }

      // Extract exports
      if (node.type === 'ExportNamedDeclaration' || 
          node.type === 'ExportDefaultDeclaration') {
        fileInfo.exports.push({
          type: node.type,
          line: node.loc ? node.loc.start.line : 0
        });
      }

      // Recursively traverse children
      for (const key in node) {
        if (key !== 'parent' && key !== 'leadingComments' && key !== 'trailingComments') {
          const child = node[key];
          if (Array.isArray(child)) {
            child.forEach(item => {
              complexity = traverse(item, depth + 1, complexity);
            });
          } else if (child && typeof child === 'object') {
            complexity = traverse(child, depth + 1, complexity);
          }
        }
      }

      return complexity;
    };

    fileInfo.cyclomaticComplexity = traverse(ast, 0, 1);
    fileInfo.maxNesting = maxNesting;

    // Calculate Maintainability Index
    // MI = 171 - 5.2 * ln(Halstead Volume) - 0.23 * (Cyclomatic Complexity) - 16.2 * ln(Lines of Code)
    // Simplified version
    const halsteadVolume = fileInfo.linesOfCode * 10; // Approximation
    const mi = Math.max(0, Math.min(100, 
      171 - 5.2 * Math.log(Math.max(1, halsteadVolume)) 
      - 0.23 * fileInfo.cyclomaticComplexity 
      - 16.2 * Math.log(Math.max(1, fileInfo.linesOfCode))
    ));
    fileInfo.maintainabilityIndex = mi;

    // Calculate Information Content
    const uniqueTokens = new Set();
    const tokens = esprima.tokenize(fileInfo.path, { loc: false });
    tokens.forEach(token => {
      if (token.type === 'Identifier' || token.type === 'Keyword') {
        uniqueTokens.add(token.value);
      }
    });
    fileInfo.informationContent = uniqueTokens.size;
  }

  calculateProjectMetrics() {
    const totalLOC = this.files.reduce((sum, f) => sum + f.linesOfCode, 0);
    const totalComments = this.files.reduce((sum, f) => sum + f.linesOfComments, 0);
    const totalBlank = this.files.reduce((sum, f) => sum + f.linesBlank, 0);
    const totalFunctions = this.functions.length;
    const totalClasses = this.classes.length;
    const fileCount = this.files.length;
    const avgComplexity = fileCount > 0 
      ? this.files.reduce((sum, f) => sum + f.cyclomaticComplexity, 0) / fileCount 
      : 0;
    const maxComplexity = this.files.length > 0 
      ? Math.max(...this.files.map(f => f.cyclomaticComplexity), 0)
      : 0;
    const avgMaintainability = fileCount > 0
      ? this.files.reduce((sum, f) => sum + f.maintainabilityIndex, 0) / fileCount
      : 0;
    const totalImports = this.imports.length;
    const totalExports = this.exports.length;

    // Code quality metrics
    const avgFunctionLength = totalFunctions > 0
      ? this.functions.reduce((sum, f) => sum + f.length, 0) / totalFunctions
      : 0;

    const avgParamsPerFunction = totalFunctions > 0
      ? this.functions.reduce((sum, f) => sum + f.params, 0) / totalFunctions
      : 0;

    return {
      fileCount: fileCount,
      fileDetails: this.files,
      totalLOC,
      totalComments,
      totalBlank,
      effectiveLOC: totalLOC - totalComments - totalBlank,
      totalFunctions,
      totalClasses,
      avgComplexity,
      maxComplexity,
      avgMaintainability,
      totalImports,
      totalExports,
      avgFunctionLength,
      avgParamsPerFunction,
      codeToCommentRatio: totalLOC > 0 ? (totalComments / totalLOC) * 100 : 0,
      functionsPerFile: fileCount > 0 ? totalFunctions / fileCount : 0
    };
  }
}

function findJSFiles(dir, extensions = ['.js', '.jsx', '.ts', '.tsx']) {
  const files = [];
  
  function traverse(currentPath) {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.name === 'node_modules' || entry.name === 'build' || 
            entry.name === '.next' || entry.name.startsWith('.')) {
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
    } catch (error) {
      // Skip directories we can't read
    }
  }
  
  traverse(dir);
  return files;
}

function formatNumber(num, decimals = 2) {
  return typeof num === 'number' ? num.toFixed(decimals) : 'N/A';
}

function generateReport(metrics, outputFile = 'information-metrics-report.txt') {
  const report = [];

  report.push(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    INFORMATION METRICS ANALYSIS REPORT                       ║
║                    Generated: ${new Date().toLocaleString().padEnd(50)} ║
╚══════════════════════════════════════════════════════════════════════════════╝

`);

  // Project Summary
  report.push(`
╔════════════════════════════════════════════════════════════════╗
║                    PROJECT SUMMARY                            ║
╠════════════════════════════════════════════════════════════════╣
║  Total Files Analyzed:              ${metrics.fileCount.toString().padStart(10)} ║
║  Total Lines of Code (LOC):          ${metrics.totalLOC.toString().padStart(10)} ║
║  Lines of Comments:                  ${metrics.totalComments.toString().padStart(10)} ║
║  Blank Lines:                        ${metrics.totalBlank.toString().padStart(10)} ║
║  Effective LOC:                      ${metrics.effectiveLOC.toString().padStart(10)} ║
║                                                                 ║
║  Total Functions:                   ${metrics.totalFunctions.toString().padStart(10)} ║
║  Total Classes:                      ${metrics.totalClasses.toString().padStart(10)} ║
║  Total Imports:                     ${metrics.totalImports.toString().padStart(10)} ║
║  Total Exports:                      ${metrics.totalExports.toString().padStart(10)} ║
╚════════════════════════════════════════════════════════════════╝
`);

  // Code Quality Metrics
  report.push(`
╔════════════════════════════════════════════════════════════════╗
║                    CODE QUALITY METRICS                        ║
╠════════════════════════════════════════════════════════════════╣
║  Average Cyclomatic Complexity:     ${formatNumber(metrics.avgComplexity).padStart(10)} ║
║  Maximum Complexity:                 ${metrics.maxComplexity.toString().padStart(10)} ║
║  Average Maintainability Index:      ${formatNumber(metrics.avgMaintainability).padStart(10)} ║
║                                                                 ║
║  Average Function Length:            ${formatNumber(metrics.avgFunctionLength).padStart(10)} lines ║
║  Average Parameters per Function:    ${formatNumber(metrics.avgParamsPerFunction).padStart(10)} ║
║  Functions per File:                 ${formatNumber(metrics.functionsPerFile).padStart(10)} ║
║  Code to Comment Ratio:               ${formatNumber(metrics.codeToCommentRatio).padStart(10)}% ║
╚════════════════════════════════════════════════════════════════╝
`);

  // Maintainability Index Interpretation
  let maintainabilityRating = 'Unknown';
  if (metrics.avgMaintainability >= 80) maintainabilityRating = 'Excellent';
  else if (metrics.avgMaintainability >= 60) maintainabilityRating = 'Good';
  else if (metrics.avgMaintainability >= 40) maintainabilityRating = 'Fair';
  else maintainabilityRating = 'Poor';

  let complexityRating = 'Low';
  if (metrics.avgComplexity > 20) complexityRating = 'Very High';
  else if (metrics.avgComplexity > 10) complexityRating = 'High';
  else if (metrics.avgComplexity > 5) complexityRating = 'Moderate';
  else complexityRating = 'Low';

  report.push(`
╔════════════════════════════════════════════════════════════════╗
║                    INTERPRETATION                               ║
╠════════════════════════════════════════════════════════════════╣
║  Maintainability Rating:           ${maintainabilityRating.padStart(15)} ║
║  Complexity Rating:                  ${complexityRating.padStart(15)} ║
║                                                                 ║
║  Maintainability Index Scale:                                  ║
║    • 80-100: Excellent (easy to maintain)                      ║
║    • 60-79:  Good (moderate maintenance)                       ║
║    • 40-59:  Fair (requires attention)                         ║
║    • 0-39:   Poor (needs refactoring)                          ║
║                                                                 ║
║  Cyclomatic Complexity Scale:                                  ║
║    • 1-5:    Low (simple)                                       ║
║    • 6-10:   Moderate                                           ║
║    • 11-20:  High                                               ║
║    • >20:    Very High (needs refactoring)                     ║
╚════════════════════════════════════════════════════════════════╝
`);

  // File-level details
  if (metrics.fileDetails && metrics.fileDetails.length > 0) {
    report.push(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                         FILE-LEVEL DETAILS                                   ║
╠══════════════════════════════════════════════════════════════════════════════╣
`);

    metrics.fileDetails.forEach(file => {
      report.push(`
║  File: ${file.name.padEnd(60)} ║
║    Lines of Code: ${file.linesOfCode.toString().padStart(5)} | ` +
`Complexity: ${file.cyclomaticComplexity.toString().padStart(3)} | ` +
`Functions: ${file.functions.length.toString().padStart(2)} | ` +
`MI: ${formatNumber(file.maintainabilityIndex).padStart(5)} ║`);
    });

    report.push(`
╚══════════════════════════════════════════════════════════════════════════════╝
`);
  }

  const reportText = report.join('\n');
  fs.writeFileSync(outputFile, reportText);
  console.log(reportText);
  console.log(`\n✅ Report saved to: ${outputFile}`);
  
  return reportText;
}

// Main execution
const args = process.argv.slice(2);
const targetDir = args[0] || process.cwd();

console.log(`\n🔍 Analyzing files for information metrics in: ${targetDir}\n`);

const analyzer = new InformationMetrics();

// Find and analyze files
const serverFiles = findJSFiles(path.join(targetDir, 'server'));
const clientFiles = findJSFiles(path.join(targetDir, 'client/white_board_pranjal/app'));

const allFiles = [...serverFiles, ...clientFiles];

if (allFiles.length === 0) {
  console.log('❌ No JavaScript/TypeScript files found!');
  process.exit(1);
}

console.log(`📁 Found ${allFiles.length} files to analyze:\n`);
allFiles.forEach(file => {
  console.log(`   • ${file}`);
  analyzer.analyzeFile(file);
});

console.log('\n📊 Calculating metrics...\n');

const projectMetrics = analyzer.calculateProjectMetrics();
projectMetrics.files = analyzer.files; // Include file details

generateReport(projectMetrics, path.join(targetDir, 'information-metrics-report.txt'));

