#!/usr/bin/env node

/**
 * Live Variables Analysis
 * 
 * Calculates live variables at different points in the code:
 * - A variable is "live" at a point if it has been assigned and may be used later
 * - Tracks variable definitions (writes) and uses (reads)
 * - Reports live variables per function/scope
 */

const fs = require('fs');
const path = require('path');
const esprima = require('esprima');
const estraverse = require('estraverse');

class LiveVariablesAnalyzer {
  constructor() {
    this.functions = new Map(); // function name -> analysis data
    this.scopes = new Map(); // scope ID -> scope data
    this.scopeCounter = 0;
  }

  findJSFiles(dir, extensions = ['.js', '.jsx']) {
    const files = [];
    if (!fs.existsSync(dir)) return files;

    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip node_modules and other common directories
        if (!['node_modules', '.git', 'dist', 'build'].includes(item)) {
          files.push(...this.findJSFiles(fullPath, extensions));
        }
      } else if (extensions.some(ext => item.endsWith(ext))) {
        files.push(fullPath);
      }
    }
    return files;
  }

  analyzeFile(filePath) {
    try {
      const code = fs.readFileSync(filePath, 'utf8');
      const ast = esprima.parseScript(code, { loc: true, range: true });

      const fileAnalysis = {
        file: path.basename(filePath),
        path: filePath,
        functions: []
      };

      estraverse.traverse(ast, {
        enter: (node, parent) => {
          // Analyze function declarations and expressions
          if (node.type === 'FunctionDeclaration' || 
              node.type === 'FunctionExpression' ||
              node.type === 'ArrowFunctionExpression') {
            const funcAnalysis = this.analyzeFunction(node, filePath);
            if (funcAnalysis) {
              fileAnalysis.functions.push(funcAnalysis);
            }
          }
        }
      });

      return fileAnalysis;
    } catch (error) {
      console.error(`Error analyzing ${filePath}: ${error.message}`);
      return null;
    }
  }

  analyzeFunction(funcNode, filePath) {
    if (!funcNode.body) return null;

    // Get function name
    let funcName = 'anonymous';
    if (funcNode.id) {
      funcName = funcNode.id.name;
    } else if (funcNode.type === 'FunctionExpression' || 
               funcNode.type === 'ArrowFunctionExpression') {
      // Try to get name from parent
      const parent = funcNode.parent || {};
      if (parent.type === 'VariableDeclarator' && parent.id) {
        funcName = parent.id.name || 'anonymous';
      } else if (parent.type === 'Property' && parent.key) {
        funcName = parent.key.name || parent.key.value || 'anonymous';
      } else if (parent.type === 'CallExpression') {
        // Try to infer from socket.on, app.get, etc.
        if (parent.callee && parent.callee.type === 'MemberExpression') {
          const member = parent.callee;
          if (member.property && member.property.name) {
            funcName = `${member.object.name || 'unknown'}.${member.property.name}_${member.property.name}`;
          }
        }
      }
    }

    // Track variables in this function
    const variables = {
      declared: new Set(), // Variables declared in this scope
      assigned: new Set(), // Variables assigned
      used: new Set(),     // Variables used/read
      live: new Set()      // Live variables
    };

    // Track variable definitions and uses
    const definitions = new Map(); // var -> line number where defined
    const uses = []; // { var, line, isRead, isWrite }
    const statements = []; // All statements with their line numbers

    this.extractVariables(funcNode.body, variables, definitions, uses, statements, 0);

    // Calculate live variables using forward analysis
    const liveAtPoint = this.calculateLiveVariables(statements, definitions, uses);

    return {
      name: funcName,
      line: funcNode.loc.start.line,
      variables: {
        declared: Array.from(variables.declared).sort(),
        assigned: Array.from(variables.assigned).sort(),
        used: Array.from(variables.used).sort(),
        liveAtEntry: Array.from(liveAtPoint.entry || []).sort(),
        liveAtExit: Array.from(liveAtPoint.exit || []).sort()
      },
      liveAtStatements: liveAtPoint.statements || [],
      totalVariables: variables.declared.size,
      totalAssignments: variables.assigned.size,
      totalUses: variables.used.size
    };
  }

  extractVariables(node, variables, definitions, uses, statements, depth) {
    if (!node) return;

    estraverse.traverse(node, {
      enter: (node, parent) => {
        const line = node.loc ? node.loc.start.line : 0;

        // Variable declarations
        if (node.type === 'VariableDeclarator') {
          if (node.id && node.id.type === 'Identifier') {
            const varName = node.id.name;
            variables.declared.add(varName);
            variables.assigned.add(varName);
            
            definitions.set(varName, line);
            uses.push({ var: varName, line, isRead: false, isWrite: true });
          }
        }

        // Assignments
        if (node.type === 'AssignmentExpression') {
          if (node.left && node.left.type === 'Identifier') {
            const varName = node.left.name;
            variables.assigned.add(varName);
            definitions.set(varName, line);
            uses.push({ var: varName, line, isRead: false, isWrite: true });
          }
        }

        // Variable reads (Identifier not on left side of assignment)
        if (node.type === 'Identifier' && parent) {
          const varName = node.name;
          
          // Check if this is a read (not a declaration or left side of assignment)
          const isDeclaration = parent.type === 'VariableDeclarator' && 
                               parent.id === node;
          const isLeftSideOfAssignment = parent.type === 'AssignmentExpression' && 
                                        parent.left === node;
          const isPropertyKey = parent.type === 'Property' && 
                               parent.key === node;
          const isFunctionName = (parent.type === 'FunctionDeclaration' || 
                                parent.type === 'FunctionExpression') && 
                               parent.id === node;

          if (!isDeclaration && !isLeftSideOfAssignment && 
              !isPropertyKey && !isFunctionName) {
            // This is a variable read
            variables.used.add(varName);
            uses.push({ var: varName, line, isRead: true, isWrite: false });
          }
        }

        // Track statements (not expressions inside other statements)
        if (this.isStatement(node)) {
          statements.push({ node, line, type: node.type });
        }
      }
    });
  }

  isStatement(node) {
    return [
      'ExpressionStatement', 'VariableDeclaration', 'IfStatement',
      'ForStatement', 'WhileStatement', 'DoWhileStatement',
      'SwitchStatement', 'ReturnStatement', 'BreakStatement',
      'ContinueStatement', 'TryStatement', 'ThrowStatement',
      'FunctionDeclaration', 'LabeledStatement', 'BlockStatement'
    ].includes(node.type);
  }

  calculateLiveVariables(statements, definitions, uses) {
    // Forward analysis: a variable is live if it's been defined and may be used
    const liveAtEntry = new Set();
    const liveAtExit = new Set();
    const liveAtStatements = [];

    // Build a map of variable -> last use line
    const lastUse = new Map();
    uses.forEach(use => {
      if (use.isRead) {
        const current = lastUse.get(use.var) || 0;
        lastUse.set(use.var, Math.max(current, use.line));
      }
    });

    // Build a map of variable -> definition line
    const defLine = new Map();
    definitions.forEach((line, varName) => {
      defLine.set(varName, line);
    });

    // For each statement, determine live variables
    statements.forEach((stmt, index) => {
      const stmtLine = stmt.line;
      const liveVars = new Set();

      // A variable is live at this point if:
      // 1. It has been defined before or at this line
      // 2. It is used at or after this line
      definitions.forEach((defLineNum, varName) => {
        if (defLineNum <= stmtLine) {
          // Variable has been defined
          const lastUseLine = lastUse.get(varName) || 0;
          if (lastUseLine >= stmtLine) {
            // Variable is used at or after this point
            liveVars.add(varName);
          }
        }
      });

      liveAtStatements.push({
        line: stmtLine,
        type: stmt.type,
        liveVariables: Array.from(liveVars).sort(),
        count: liveVars.size
      });

      // Update entry/exit sets
      if (index === 0) {
        liveVars.forEach(v => liveAtEntry.add(v));
      }
      if (index === statements.length - 1) {
        liveVars.forEach(v => liveAtExit.add(v));
      }
    });

    return {
      entry: liveAtEntry,
      exit: liveAtExit,
      statements: liveAtStatements
    };
  }

  generateReport(analyses, outputFile = 'live-variables-report.txt') {
    const report = [];

    report.push(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    LIVE VARIABLES ANALYSIS REPORT                           ║
║                    Generated: ${new Date().toLocaleString().padEnd(50)} ║
╚══════════════════════════════════════════════════════════════════════════════╝

`);

    let totalFunctions = 0;
    let totalVariables = 0;
    let totalLiveVars = 0;

    analyses.forEach(analysis => {
      if (!analysis || !analysis.functions.length) return;

      report.push(`
╔════════════════════════════════════════════════════════════════╗
║  FILE: ${analysis.file.padEnd(55)} ║
╠════════════════════════════════════════════════════════════════╣
`);

      analysis.functions.forEach(func => {
        totalFunctions++;
        totalVariables += func.totalVariables;

        report.push(`
║  Function: ${func.name.padEnd(50)} (Line ${func.line.toString().padStart(4)}) ║
╠════════════════════════════════════════════════════════════════╣
║  Total Variables Declared:     ${func.totalVariables.toString().padStart(4)} ║
║  Total Assignments:             ${func.totalAssignments.toString().padStart(4)} ║
║  Total Variable Uses:          ${func.totalUses.toString().padStart(4)} ║
║  Live Variables at Entry:      ${func.variables.liveAtEntry.length.toString().padStart(4)} ║
║  Live Variables at Exit:       ${func.variables.liveAtExit.length.toString().padStart(4)} ║
║                                                                 ║
`);

        if (func.variables.liveAtEntry.length > 0) {
          report.push(`║  Live at Entry: ${func.variables.liveAtEntry.join(', ').padEnd(45)} ║\n`);
        }

        if (func.variables.liveAtExit.length > 0) {
          report.push(`║  Live at Exit:  ${func.variables.liveAtExit.join(', ').padEnd(45)} ║\n`);
        }

        // Show live variables at key statements
        if (func.liveAtStatements && func.liveAtStatements.length > 0) {
          const significantStatements = func.liveAtStatements.filter(s => s.count > 0);
          if (significantStatements.length > 0) {
            report.push(`║                                                                 ║\n`);
            report.push(`║  Live Variables by Statement:                                    ║\n`);
            
            significantStatements.slice(0, 10).forEach(stmt => {
              const liveStr = stmt.liveVariables.join(', ');
              const displayStr = liveStr.length > 40 ? liveStr.substring(0, 37) + '...' : liveStr;
              report.push(`║    Line ${stmt.line.toString().padStart(3)} (${stmt.type.padEnd(18)}): ${displayStr.padEnd(40)} ║\n`);
            });
          }
        }

        totalLiveVars += func.variables.liveAtEntry.length;
        report.push(`╚════════════════════════════════════════════════════════════════╝\n`);
      });
    });

    // Summary
    report.push(`
╔════════════════════════════════════════════════════════════════╗
║                         SUMMARY                                ║
╠════════════════════════════════════════════════════════════════╣
║  Total Files Analyzed:                  ${analyses.filter(a => a && a.functions.length > 0).length.toString().padStart(4)} ║
║  Total Functions:                       ${totalFunctions.toString().padStart(4)} ║
║  Total Variables Declared:              ${totalVariables.toString().padStart(4)} ║
║  Average Live Variables per Function:   ${totalFunctions > 0 ? (totalLiveVars / totalFunctions).toFixed(2).padStart(7) : '0.00'} ║
╚════════════════════════════════════════════════════════════════╝

╔════════════════════════════════════════════════════════════════╗
║                    INTERPRETATION                              ║
╠════════════════════════════════════════════════════════════════╣
║  Live Variables: Variables that have been assigned and may     ║
║                  be used later in the code                     ║
║                                                                 ║
║  High Live Variables: More variables in scope = higher         ║
║                      memory usage and complexity              ║
║                                                                 ║
║  Best Practice: Minimize live variables by using smaller        ║
║                 scopes and declaring variables close to use     ║
╚════════════════════════════════════════════════════════════════╝
`);

    const reportText = report.join('');
    fs.writeFileSync(outputFile, reportText);
    console.log(reportText);
    console.log(`\n✅ Report saved to: ${outputFile}`);
  }
}

// Main execution
function main() {
  const analyzer = new LiveVariablesAnalyzer();
  const projectRoot = process.cwd();

  console.log(`\n🔍 Analyzing live variables in: ${projectRoot}\n`);

  const jsFiles = analyzer.findJSFiles(projectRoot);
  
  console.log(`📁 Found ${jsFiles.length} files to analyze:\n`);
  jsFiles.forEach(file => {
    console.log(`   • ${file}`);
  });

  console.log(`\n📊 Calculating live variables...\n`);

  const analyses = jsFiles.map(file => analyzer.analyzeFile(file));
  analyzer.generateReport(analyses.filter(a => a !== null));
}

if (require.main === module) {
  main();
}

module.exports = LiveVariablesAnalyzer;

