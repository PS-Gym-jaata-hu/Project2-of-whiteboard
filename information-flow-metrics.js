#!/usr/bin/env node

/**
 * Information Flow Metrics Calculator
 * 
 * Calculates information flow metrics for code analysis:
 * - Fan-in / Fan-out
 * - Coupling metrics
 * - Cohesion metrics
 * - Information Flow Complexity
 * - Data Flow Complexity
 * - Dependency graphs
 */

const fs = require('fs');
const path = require('path');
const esprima = require('esprima');

class InformationFlowAnalyzer {
  constructor() {
    this.modules = new Map(); // module name -> module info
    this.functions = new Map(); // function name -> function info
    this.calls = []; // all function calls
    this.imports = new Map(); // file -> imports
    this.exports = new Map(); // file -> exports
  }

  analyzeFile(filePath) {
    try {
      const code = fs.readFileSync(filePath, 'utf8');
      const moduleName = path.basename(filePath, path.extname(filePath));
      const fileInfo = {
        path: filePath,
        name: moduleName,
        fullPath: filePath,
        functions: [],
        calls: [],
        imports: [],
        exports: [],
        fanIn: 0,
        fanOut: 0,
        cohesion: 0
      };

      const ast = esprima.parseScript(code, {
        loc: true,
        range: true,
        tolerant: true,
        sourceType: 'module'
      });

      this.analyzeAST(ast, fileInfo);
      this.modules.set(filePath, fileInfo);
    } catch (error) {
      // Skip files that can't be parsed (TypeScript/JSX)
    }
  }

  analyzeAST(ast, fileInfo) {
    let functionCounter = 0;
    
    const traverse = (node, parentName = '', depth = 0) => {
      if (!node || typeof node !== 'object') return;

      // Extract function definitions - handle all types properly
      let funcInfo = null;
      let funcName = 'anonymous';
      
      if (node.type === 'FunctionDeclaration') {
        funcName = node.id ? node.id.name : `anonymous_${functionCounter++}`;
        funcInfo = {
          name: funcName,
          file: fileInfo.path,
          module: fileInfo.name,
          params: node.params ? node.params.map(p => {
            if (p.type === 'Identifier') return p.name;
            return 'unnamed';
          }) : [],
          calls: [],
          fanIn: 0,
          fanOut: 0,
          line: node.loc ? node.loc.start.line : 0,
          type: 'function'
        };
      } else if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
        // Try to get name from parent context
        // Check if it's a callback to socket.on, app.get, etc.
        let parent = node.parent;
        let foundName = false;
        
        // Walk up the parent chain to find the event name or method name
        while (parent && !foundName) {
          if (parent.type === 'CallExpression' && parent.arguments && parent.arguments.includes(node)) {
            // Check if this is socket.on('event-name', callback)
            const callee = parent.callee;
            if (callee && callee.type === 'MemberExpression') {
              const methodName = callee.property ? callee.property.name : null;
              const objectName = callee.object ? callee.object.name : null;
              
              // Find the event name argument (usually first string argument)
              const eventArg = parent.arguments.find(arg => 
                arg.type === 'Literal' && typeof arg.value === 'string'
              );
              
              if (eventArg && methodName && objectName) {
                funcName = `${objectName}.${methodName}_${eventArg.value}`;
                foundName = true;
                break;
              }
              
              // Fallback: use method name
              if (methodName && objectName) {
                funcName = `${objectName}.${methodName}_handler`;
                foundName = true;
                break;
              }
            }
          }
          
          if (parent.type === 'VariableDeclarator' && parent.id) {
            funcName = parent.id.name || `anonymous_${functionCounter++}`;
            foundName = true;
            break;
          }
          
          if (parent.type === 'Property' && parent.key) {
            funcName = parent.key.name || `anonymous_${functionCounter++}`;
            foundName = true;
            break;
          }
          
          parent = parent.parent;
        }
        
        if (!foundName) {
          funcName = `anonymous_${functionCounter++}`;
        }
        
        funcInfo = {
          name: funcName,
          file: fileInfo.path,
          module: fileInfo.name,
          params: node.params ? node.params.map(p => {
            if (p.type === 'Identifier') return p.name;
            if (p.type === 'ObjectPattern') return 'object';
            if (p.type === 'ArrayPattern') return 'array';
            return 'unnamed';
          }) : [],
          calls: [],
          fanIn: 0,
          fanOut: 0,
          line: node.loc ? node.loc.start.line : 0,
          type: node.type === 'ArrowFunctionExpression' ? 'arrow' : 'function'
        };
      }

      if (funcInfo) {
        // Analyze function body for calls
        if (node.body) {
          this.extractCalls(node.body, funcInfo);
        }

        // Check if this function already exists (avoid duplicates)
        const existingFunc = fileInfo.functions.find(f => f.name === funcName && f.line === funcInfo.line);
        if (!existingFunc) {
          fileInfo.functions.push(funcInfo);
          const functionKey = `${fileInfo.path}::${funcName}_${funcInfo.line}`;
          // Avoid duplicate keys
          if (!this.functions.has(functionKey)) {
            this.functions.set(functionKey, funcInfo);
          }
        }
      }

      // Extract imports
      if (node.type === 'ImportDeclaration') {
        const importInfo = {
          source: node.source ? node.source.value : '',
          specifiers: node.specifiers ? node.specifiers.map(s => s.local ? s.local.name : '') : [],
          imported: node.specifiers ? node.specifiers.map(s => s.imported ? s.imported.name : '') : []
        };
        fileInfo.imports.push(importInfo);
      }

      // Extract exports
      if (node.type === 'ExportNamedDeclaration' || 
          node.type === 'ExportDefaultDeclaration') {
        const exportInfo = {
          type: node.type,
          exported: node.declaration ? node.declaration.name : 'default',
          line: node.loc ? node.loc.start.line : 0
        };
        fileInfo.exports.push(exportInfo);
      }

      // Extract function calls (but not inside function definitions)
      if (!funcInfo && (node.type === 'CallExpression' || node.type === 'MemberExpression')) {
        const calleeName = this.getCalleeName(node);
        if (calleeName && calleeName !== 'require' && calleeName !== 'console') {
          fileInfo.calls.push({
            name: calleeName,
            line: node.loc ? node.loc.start.line : 0,
            type: node.type
          });
          this.calls.push({
            from: fileInfo.path,
            to: calleeName,
            line: node.loc ? node.loc.start.line : 0
          });
        }
      }

      // Store parent reference for nested functions
      if (funcInfo) {
        node.parent = funcInfo;
      }

      // Recursively traverse children
      const currentParent = funcInfo ? funcInfo.name : parentName;
      for (const key in node) {
        if (key !== 'parent' && key !== 'leadingComments' && key !== 'trailingComments') {
          const child = node[key];
          if (Array.isArray(child)) {
            child.forEach(item => {
              if (item && typeof item === 'object') {
                item.parent = node;
                traverse(item, currentParent, depth + 1);
              }
            });
          } else if (child && typeof child === 'object') {
            child.parent = node;
            traverse(child, currentParent, depth + 1);
          }
        }
      }
    };

    traverse(ast);
  }

  extractCalls(node, funcInfo) {
    if (!node || typeof node !== 'object') return;

    // Stop traversing if we hit a nested function definition
    // (we only want calls within THIS function, not nested functions)
    if (node.type === 'FunctionDeclaration' || 
        node.type === 'FunctionExpression' || 
        node.type === 'ArrowFunctionExpression') {
      // Don't traverse into nested functions
      return;
    }

    if (node.type === 'CallExpression') {
      const callee = node.callee;
      
      // Check if this is a direct function call (Identifier) vs method call (MemberExpression)
      if (callee.type === 'Identifier') {
        // This is a direct function call (e.g., generateRoomId())
        const funcName = callee.name;
        
        // Filter out built-ins
        const builtins = ['console', 'require', 'setTimeout', 'setInterval', 'clearTimeout', 
                         'clearInterval', 'Math', 'Array', 'Set', 'Map', 'Object', 'parseInt', 
                         'parseFloat', 'isNaN', 'isFinite'];
        
        if (!builtins.includes(funcName) && !funcInfo.calls.includes(funcName)) {
          funcInfo.calls.push(funcName);
          funcInfo.fanOut++; // Direct function calls count as fan-out
        }
      } else if (callee.type === 'MemberExpression') {
        // This is a method call (e.g., socket.emit(), rooms.set())
        // Store it for dependency tracking but don't count as fan-out to user functions
        const calleeName = this.getCalleeName(node);
        if (calleeName && !funcInfo.calls.includes(calleeName)) {
          // Only store for reference, don't increment fan-out
          // Method calls on library objects don't count as fan-out to user-defined functions
          funcInfo.calls.push(calleeName);
        }
      }
    }

    // Recursively traverse children, but skip nested function definitions
    for (const key in node) {
      if (key !== 'parent' && key !== 'leadingComments' && key !== 'trailingComments') {
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(item => {
            // Skip nested function definitions
            if (item && typeof item === 'object' && 
                item.type !== 'FunctionDeclaration' && 
                item.type !== 'FunctionExpression' && 
                item.type !== 'ArrowFunctionExpression') {
              this.extractCalls(item, funcInfo);
            }
          });
        } else if (child && typeof child === 'object' &&
                   child.type !== 'FunctionDeclaration' &&
                   child.type !== 'FunctionExpression' &&
                   child.type !== 'ArrowFunctionExpression') {
          this.extractCalls(child, funcInfo);
        }
      }
    }
  }

  getCalleeName(node) {
    if (node.type === 'CallExpression') {
      if (node.callee.type === 'Identifier') {
        return node.callee.name;
      } else if (node.callee.type === 'MemberExpression') {
        // Handle socket.emit, io.on, etc.
        const object = node.callee.object;
        const property = node.callee.property;
        if (object && property) {
          if (object.type === 'Identifier') {
            return `${object.name}.${property.name}`;
          }
          return property.name;
        }
        return property ? property.name : null;
      }
    } else if (node.type === 'MemberExpression') {
      const property = node.property;
      const object = node.object;
      if (property) {
        if (object && object.type === 'Identifier') {
          return `${object.name}.${property.name}`;
        }
        return property.name;
      }
    }
    return null;
  }

  calculateFanInFanOut() {
    // Reset all fan-in counters
    this.functions.forEach((func) => {
      func.fanIn = 0;
    });

    // Use a Map to track unique callers for each function to avoid double counting
    // Key: function, Value: Set of unique caller identifiers
    const fanInMap = new Map();
    this.functions.forEach((func) => {
      fanInMap.set(func, new Set());
    });

    // Count internal function calls within each module
    this.modules.forEach((module, filePath) => {
      // Deduplicate functions by name+line to avoid counting same function twice
      const functionKeys = new Set();
      const uniqueFunctions = module.functions.filter(func => {
        const key = `${func.name}_${func.line}`;
        if (functionKeys.has(key)) {
          return false; // Duplicate
        }
        functionKeys.add(key);
        return true;
      });
      
      // Count calls between unique functions
      uniqueFunctions.forEach(func1 => {
        uniqueFunctions.forEach(func2 => {
          if (func1 !== func2) {
            // Count how many times func1 calls func2 in its calls array
            const callCount = func1.calls.filter(call => call === func2.name).length;
            
            if (callCount > 0) {
              // Track unique callers - each function can only be counted once as a caller
              const callers = fanInMap.get(func2);
              const callerKey = `${func1.name}_${func1.line}`;
              // Only count once per unique caller function
              if (!callers.has(callerKey)) {
                callers.add(callerKey);
                // Fan-in is the number of unique functions that call this function
                // Not the number of call sites
                func2.fanIn = callers.size;
              }
            }
          }
        });
      });
    });

    // Also count external calls (calls from other files)
    // But don't double count if already counted internally
    this.calls.forEach(call => {
      this.functions.forEach((func) => {
        // Only count if call is from a different file and exact match
        // AND not already counted as an internal call
        if (call.from !== func.file && call.to === func.name) {
          const callers = fanInMap.get(func);
          // Use file path as key to avoid duplicates
          if (!callers.has(call.from)) {
            callers.add(call.from);
            func.fanIn = callers.size;
          }
        }
      });
    });

    // Calculate module-level fan-in/fan-out
    this.modules.forEach((module, filePath) => {
      // Fan-out: number of unique external calls this module makes
      // (excluding calls to its own functions)
      const moduleFunctionNames = new Set(module.functions.map(f => f.name));
      const externalCalls = module.calls.filter(c => {
        // Check if call is to an external function (not in this module)
        return !moduleFunctionNames.has(c.name) && 
               !c.name.split('.').some(part => moduleFunctionNames.has(part));
      });
      const uniqueExternalCalls = new Set(externalCalls.map(c => {
        // Group by base object (socket, io, app, etc.)
        const parts = c.name.split('.');
        return parts.length > 1 ? parts[0] : c.name;
      }));
      module.fanOut = uniqueExternalCalls.size;

      // Fan-in: number of times functions in this module are called from elsewhere
      let fanInCount = 0;
      this.calls.forEach(call => {
        if (call.from !== filePath) {
          module.functions.forEach(func => {
            if (call.to === func.name || 
                call.to.includes(func.name) ||
                (call.to.includes('.') && call.to.split('.')[1] === func.name)) {
              fanInCount++;
            }
          });
        }
      });
      
      // Also count internal calls within the module
      const internalCalls = new Set();
      module.functions.forEach(func1 => {
        module.functions.forEach(func2 => {
          if (func1 !== func2) {
            const callsFunc2 = func1.calls.some(call => 
              call === func2.name || call.includes(func2.name)
            );
            if (callsFunc2) {
              internalCalls.add(`${func1.name}->${func2.name}`);
            }
          }
        });
      });
      
      module.fanIn = fanInCount + internalCalls.size;
    });
  }

  calculateCoupling() {
    const couplingMetrics = {
      tightCoupling: 0,
      looseCoupling: 0,
      couplingPairs: []
    };

    // Since we only have one module (server.js), calculate internal coupling
    // between different functional areas (socket handlers, room management, etc.)
    const modules = Array.from(this.modules.values());
    
    if (modules.length === 1) {
      // Single module: analyze coupling between functional groups
      const module = modules[0];
      const functionalGroups = {
        'room-management': ['generateRoomId', 'create', 'join'],
        'socket-handlers': ['connection', 'create-room', 'join-room', 'draw', 'canvas-state', 'disconnect'],
        'canvas-management': ['canvas-state', 'canvasState']
      };

      // For single module, coupling is measured between function groups
      const groups = Object.keys(functionalGroups);
      for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          const group1 = functionalGroups[groups[i]];
          const group2 = functionalGroups[groups[j]];
          
          let callsBetween = 0;
          module.functions.forEach(func => {
            if (group1.some(g => func.name.includes(g))) {
              func.calls.forEach(call => {
                if (group2.some(g => call.includes(g))) {
                  callsBetween++;
                }
              });
            }
          });

          if (callsBetween > 0) {
            couplingMetrics.couplingPairs.push({
              module1: groups[i],
              module2: groups[j],
              calls: callsBetween,
              type: callsBetween > 5 ? 'tight' : 'loose'
            });

            if (callsBetween > 5) {
              couplingMetrics.tightCoupling++;
            } else {
              couplingMetrics.looseCoupling++;
            }
          }
        }
      }
    } else {
      // Multiple modules: calculate inter-module coupling
      this.modules.forEach((module1, path1) => {
        this.modules.forEach((module2, path2) => {
          if (path1 < path2) {
            const callsBetween = this.calls.filter(c => 
              (c.from === path1 && c.to.includes(module2.name)) ||
              (c.from === path2 && c.to.includes(module1.name))
            ).length;

            if (callsBetween > 0) {
              couplingMetrics.couplingPairs.push({
                module1: module1.name,
                module2: module2.name,
                calls: callsBetween,
                type: callsBetween > 5 ? 'tight' : 'loose'
              });

              if (callsBetween > 5) {
                couplingMetrics.tightCoupling++;
              } else {
                couplingMetrics.looseCoupling++;
              }
            }
          }
        });
      });
    }

    return couplingMetrics;
  }

  calculateCohesion() {
    const cohesionMetrics = [];

    this.modules.forEach((module, filePath) => {
      if (module.functions.length === 0) {
        cohesionMetrics.push({
          module: module.name,
          cohesion: 1,
          reason: 'No functions to measure'
        });
        return;
      }

      if (module.functions.length === 1) {
        cohesionMetrics.push({
          module: module.name,
          cohesion: 1,
          reason: 'Single function module'
        });
        module.cohesion = 1;
        return;
      }

      // Calculate cohesion based on:
      // 1. Function calls between functions
      // 2. Shared parameters/data
      // 3. Shared external dependencies (same socket events, same data structures)
      let sharedReferences = 0;
      let totalPossiblePairs = 0;

      // Extract common dependencies per function
      const funcDependencies = module.functions.map(func => {
        const deps = new Set();
        func.calls.forEach(call => {
          // Extract base dependency (socket, io, rooms, etc.)
          if (call.includes('.')) {
            deps.add(call.split('.')[0]);
          } else {
            deps.add(call);
          }
        });
        return { func, deps };
      });

      for (let i = 0; i < module.functions.length; i++) {
        for (let j = i + 1; j < module.functions.length; j++) {
          totalPossiblePairs++;
          const func1 = module.functions[i];
          const func2 = module.functions[j];
          const deps1 = funcDependencies[i].deps;
          const deps2 = funcDependencies[j].deps;

          // Functions are cohesive if:
          // 1. They call each other
          const callsEachOther = func1.calls.some(c => 
            c === func2.name || c.includes(func2.name)
          ) || func2.calls.some(c => 
            c === func1.name || c.includes(func1.name)
          );

          // 2. They share parameters
          const sharedParams = func1.params.some(p => 
            func2.params.includes(p)
          ) || func1.params.some(p => 
            func2.params.some(p2 => p === p2 || (typeof p === 'string' && typeof p2 === 'string'))
          );

          // 3. They share dependencies (socket, rooms, io, etc.)
          const sharedDeps = Array.from(deps1).some(dep => deps2.has(dep));

          // 4. They operate on similar data structures (check by naming patterns)
          const similarData = func1.name.includes('room') && func2.name.includes('room') ||
                             func1.name.includes('canvas') && func2.name.includes('canvas') ||
                             func1.name.includes('user') && func2.name.includes('user');

          if (callsEachOther || sharedParams || sharedDeps || similarData) {
            sharedReferences++;
          }
        }
      }

      const cohesion = totalPossiblePairs > 0 
        ? sharedReferences / totalPossiblePairs 
        : 1;

      cohesionMetrics.push({
        module: module.name,
        cohesion: cohesion,
        sharedReferences: sharedReferences,
        totalPairs: totalPossiblePairs,
        rating: cohesion > 0.7 ? 'High' : cohesion > 0.3 ? 'Medium' : 'Low'
      });

      module.cohesion = cohesion;
    });

    return cohesionMetrics;
  }

  calculateInformationFlowComplexity() {
    const complexityMetrics = [];

    this.functions.forEach((func, key) => {
      // Information Flow Complexity = (fan-in * fan-out)^2
      // But only calculate if both fan-in and fan-out > 0
      let ifc = 0;
      if (func.fanIn > 0 && func.fanOut > 0) {
        ifc = Math.pow(func.fanIn * func.fanOut, 2);
      }
      
      let rating = 'Low';
      if (ifc > 100) rating = 'Very High';
      else if (ifc > 25) rating = 'High';
      else if (ifc > 5) rating = 'Medium';
      else if (func.fanIn === 0 && func.fanOut === 0) rating = 'None';
      else if (func.fanIn === 0 || func.fanOut === 0) rating = 'Low';
      
      complexityMetrics.push({
        function: func.name,
        module: func.module,
        fanIn: func.fanIn,
        fanOut: func.fanOut,
        informationFlowComplexity: ifc,
        rating: rating
      });
    });

    return complexityMetrics;
  }

  calculateProjectAverages() {
    const allFunctions = Array.from(this.functions.values());
    
    if (allFunctions.length === 0) {
      return {
        avgFanIn: 0,
        avgFanOut: 0
      };
    }

    const totalFanIn = allFunctions.reduce((sum, f) => sum + f.fanIn, 0);
    const totalFanOut = allFunctions.reduce((sum, f) => sum + f.fanOut, 0);

    return {
      avgFanIn: totalFanIn / allFunctions.length,
      avgFanOut: totalFanOut / allFunctions.length,
      totalFunctions: allFunctions.length,
      totalFanIn: totalFanIn,
      totalFanOut: totalFanOut
    };
  }

  generateMetrics() {
    this.calculateFanInFanOut();
    
    const averages = this.calculateProjectAverages();
    
    // Get all functions with their fan-in/fan-out
    const functionMetrics = Array.from(this.functions.values()).map(func => ({
      name: func.name,
      module: func.module,
      fanIn: func.fanIn,
      fanOut: func.fanOut,
      line: func.line
    }));

    return {
      functionMetrics: functionMetrics,
      projectAverages: averages,
      totalModules: this.modules.size,
      totalFunctions: this.functions.size
    };
  }
}

function findJSFiles(dir, extensions = ['.js', '.jsx']) {
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

function generateReport(metrics, outputFile = 'information-flow-metrics-report.txt') {
  const report = [];

  report.push(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                 INFORMATION FLOW METRICS - FAN-IN/FAN-OUT                     ║
║                    Generated: ${new Date().toLocaleString().padEnd(50)} ║
╚══════════════════════════════════════════════════════════════════════════════╝

`);

  // Project Summary with Averages
  report.push(`
╔════════════════════════════════════════════════════════════════╗
║                         PROJECT SUMMARY                        ║
╠════════════════════════════════════════════════════════════════╣
║  Total Modules Analyzed:              ${metrics.totalModules.toString().padStart(10)} ║
║  Total Functions:                     ${metrics.totalFunctions.toString().padStart(10)} ║
║                                                                 ║
║  Total Fan-In:                        ${metrics.projectAverages.totalFanIn.toString().padStart(10)} ║
║  Total Fan-Out:                       ${metrics.projectAverages.totalFanOut.toString().padStart(10)} ║
║                                                                 ║
║  Average Fan-In:                      ${formatNumber(metrics.projectAverages.avgFanIn).padStart(10)} ║
║  Average Fan-Out:                     ${formatNumber(metrics.projectAverages.avgFanOut).padStart(10)} ║
╚════════════════════════════════════════════════════════════════╝
`);

  // Function-level Fan-In/Fan-Out
  if (metrics.functionMetrics.length > 0) {
    report.push(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    FUNCTION-LEVEL METRICS                                    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Function                    │ Module      │ Fan-In │ Fan-Out                ║
╠══════════════════════════════════════════════════════════════════════════════╣
`);

    // Sort by fan-in descending, then by fan-out
    const sortedFunctions = metrics.functionMetrics.sort((a, b) => {
      if (b.fanIn !== a.fanIn) return b.fanIn - a.fanIn;
      return b.fanOut - a.fanOut;
    });

    sortedFunctions.forEach(func => {
      const name = func.name.length > 28 ? func.name.substring(0, 25) + '...' : func.name;
      report.push(
        `║  ${name.padEnd(28)} │ ${func.module.padEnd(10)} │ ` +
        `${func.fanIn.toString().padStart(6)} │ ${func.fanOut.toString().padStart(7)} ║`
      );
    });

    report.push(`╚══════════════════════════════════════════════════════════════════════════════╝`);
  }


  // Interpretation
  report.push(`
╔════════════════════════════════════════════════════════════════╗
║                    INTERPRETATION                              ║
╠════════════════════════════════════════════════════════════════╣
║  Fan-In:    Number of functions that call this function        ║
║             Higher = more reused (good)                        ║
║             Ideal: > 5 for reusable functions                   ║
║                                                                 ║
║  Fan-Out:   Number of user-defined functions this calls        ║
║             Higher = more dependencies                         ║
║             Ideal: < 7 (fewer dependencies = easier maintenance)║
║                                                                 ║
║  Average Fan-In:  Mean fan-in across all functions            ║
║                   Indicates overall code reusability           ║
║                                                                 ║
║  Average Fan-Out: Mean fan-out across all functions            ║
║                   Indicates overall dependency level            ║
║                                                                 ║
║  Best Practice: High Fan-In, Low Fan-Out                      ║
║                 (Reusable code with few dependencies)            ║
╚════════════════════════════════════════════════════════════════╝
`);

  const reportText = report.join('\n');
  fs.writeFileSync(outputFile, reportText);
  console.log(reportText);
  console.log(`\n✅ Report saved to: ${outputFile}`);
  
  return reportText;
}

// Main execution
const args = process.argv.slice(2);
const targetDir = args[0] || process.cwd();

console.log(`\n🔍 Analyzing information flow metrics in: ${targetDir}\n`);

const analyzer = new InformationFlowAnalyzer();

// Find and analyze files
const serverFiles = findJSFiles(path.join(targetDir, 'server'));
const clientFiles = findJSFiles(path.join(targetDir, 'client/white_board_pranjal/app'));

const allFiles = [...serverFiles, ...clientFiles];

if (allFiles.length === 0) {
  console.log('❌ No JavaScript files found!');
  process.exit(1);
}

console.log(`📁 Found ${allFiles.length} files to analyze:\n`);
allFiles.forEach(file => {
  console.log(`   • ${file}`);
  analyzer.analyzeFile(file);
});

console.log('\n📊 Calculating information flow metrics...\n');

const metrics = analyzer.generateMetrics();
generateReport(metrics, path.join(targetDir, 'information-flow-metrics-report.txt'));

