// find-cycles.js
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

class CycleDetector {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.domains = new Map();
    this.brokenFiles = new Map();
    this.stats = {
      totalFiles: 0,
      processedFiles: 0,
      brokenFiles: 0,
      domains: 0,
      fqidReferences: 0
    };
  }

  analyze() {
    console.log(`🔍 Analyzing domains in: ${this.rootDir}\n`);
    this.scanDirectory(this.rootDir);
    
    console.log(`\n📊 Statistics:`);
    console.log(`   Total files: ${this.stats.totalFiles}`);
    console.log(`   Processed: ${this.stats.processedFiles}`);
    console.log(`   Broken: ${this.stats.brokenFiles}`);
    console.log(`   Domains: ${this.stats.domains}`);
    console.log(`   FQID references: ${this.stats.fqidReferences}\n`);
    
    const cycles = this.findCycles();
    return cycles;
  }

  scanDirectory(dir) {
    try {
      const files = fs.readdirSync(dir);
      
      for (const file of files) {
        const fullPath = path.join(dir, file);
        let stat;
        
        try {
          stat = fs.statSync(fullPath);
        } catch (error) {
          continue;
        }
        
        if (stat.isDirectory()) {
          this.scanDirectory(fullPath);
        } else if (file.endsWith('.ro')) {
          this.stats.totalFiles++;
          this.processFile(fullPath);
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dir}: ${error.message}`);
    }
  }

  processFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      
      let data = null;
      
      try {
        data = yaml.load(content);
      } catch (error) {
        try {
          data = this.parseLenientYaml(content);
        } catch (error2) {
          const cleanedContent = this.cleanYamlContent(content);
          data = yaml.load(cleanedContent);
        }
      }
      
      if (!data) {
        throw new Error('Failed to parse YAML');
      }
      
      if (data.type !== 'domain') {
        return;
      }

      const domainId = data.id;
      if (!domainId) {
        throw new Error('Domain without ID');
      }

      if (!this.domains.has(domainId)) {
        this.domains.set(domainId, {
          id: domainId,
          name: data.name || domainId,
          filePath: filePath,
          fqidRefs: []
        });
      }
      
      this.stats.processedFiles++;
      this.stats.domains = this.domains.size;

      const domainData = this.domains.get(domainId);
      
      this.findFQIDReferences(data, domainId, filePath, domainData);

    } catch (error) {
      console.error(`Error processing ${filePath}: ${error.message}`);
      this.brokenFiles.set(filePath, error.message);
      this.stats.brokenFiles++;
    }
  }

  findFQIDReferences(obj, currentDomainId, filePath, domainData, currentPath = '') {
    if (!obj || typeof obj !== 'object') return;
    
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        const arrayPath = currentPath ? `${currentPath}[${index}]` : `[${index}]`;
        if (typeof item === 'object' && item !== null) {
          this.findFQIDReferences(item, currentDomainId, filePath, domainData, arrayPath);
        } else if (typeof item === 'string') {
          this.checkFQIDValue(item, currentDomainId, filePath, domainData, arrayPath);
        }
      });
      return;
    }
    
    for (const [key, value] of Object.entries(obj)) {
      const propertyPath = currentPath ? `${currentPath}.${key}` : key;
      
      if (typeof value === 'string') {
        this.checkFQIDValue(value, currentDomainId, filePath, domainData, propertyPath);
      } else if (typeof value === 'object' && value !== null) {
        this.findFQIDReferences(value, currentDomainId, filePath, domainData, propertyPath);
      }
    }
  }

  checkFQIDValue(value, currentDomainId, filePath, domainData, propertyPath) {
    if (!value || typeof value !== 'string') return;
    
    const fqidMatch = this.isFQID(value);
    if (fqidMatch) {
      const targetDomainId = fqidMatch.domainId;
      
      if (targetDomainId.toLowerCase() === currentDomainId.toLowerCase()) {
        return;
      }
      
      const reference = {
        sourceDomainId: currentDomainId,
        targetDomainId: targetDomainId,
        targetEntityId: fqidMatch.entityId,
        fullFQID: value,
        filePath: filePath,
        propertyPath: propertyPath
      };
      
      domainData.fqidRefs.push(reference);
      this.stats.fqidReferences++;
    }
  }

  isFQID(value) {
    const fqidPattern = /^([a-zA-Z0-9][\w.-]*\.[a-zA-Z0-9][\w.-]*)\/(.+)$/;
    const match = value.match(fqidPattern);
    
    if (match) {
      return {
        domainId: match[1],
        entityId: match[2]
      };
    }
    
    return null;
  }

  findCycles() {
    const cycles = [];
    const visited = new Set();
    
    for (const [domainId] of this.domains) {
        if (visited.has(domainId)) continue;
        
        const path = [];
        const pathSet = new Set();
        
        this.dfs(domainId, visited, path, pathSet, cycles);
    }
    
    // Фильтруем циклы
    const filteredCycles = cycles.filter(cycle => {
        // Убираем циклы с одним доменом (self-reference)
        if (cycle.domains.length < 2) {
            return false;
        }
        
        // Проверяем, что все домены в цикле существуют
        const allDomainsExist = cycle.domains.every(domainId => 
            this.domains.has(domainId)
        );
        
        return allDomainsExist;
    });
    
    return this.deduplicateCycles(filteredCycles);
}

  dfs(domainId, visited, path, pathSet, cycles) {
    visited.add(domainId);
    path.push(domainId);
    pathSet.add(domainId);
    
    const domainData = this.domains.get(domainId);
    if (!domainData) return;
    
    for (const ref of domainData.fqidRefs) {
      const targetDomainId = ref.targetDomainId;
      
      if (pathSet.has(targetDomainId)) {
        const cycleStart = path.indexOf(targetDomainId);
        const cycle = path.slice(cycleStart);
        
        const cycleWithRefs = {
          domains: cycle,
          closingRef: ref
        };
        
        cycles.push(cycleWithRefs);
      } else if (!visited.has(targetDomainId)) {
        this.dfs(targetDomainId, visited, path, pathSet, cycles);
      }
    }
    
    path.pop();
    pathSet.delete(domainId);
  }

  deduplicateCycles(cycles) {
    const uniqueCycles = [];
    const seenCycles = new Set();
    
    for (const cycle of cycles) {
      const sortedDomains = [...cycle.domains].sort();
      const cycleKey = sortedDomains.join('|');
      
      if (!seenCycles.has(cycleKey)) {
        seenCycles.add(cycleKey);
        uniqueCycles.push(cycle);
      }
    }
    
    return uniqueCycles;
  }

  printCycles(cycles, briefMode = false) {
    if (cycles.length === 0) {
      console.log('✅ No cyclic dependencies found.');
      return;
    }
    
    console.log(`🔴 Found ${cycles.length} cyclic dependencies:\n`);
    
    cycles.forEach((cycle, index) => {
      if (briefMode) {
        // Краткий вывод - только домены
        console.log(`${index + 1}. ${cycle.domains.join(' ⇄ ')}`);
      } else {
        // Полный вывод
        console.log(`\n${'='.repeat(80)}`);
        console.log(`Cycle #${index + 1}`);
        console.log(`${'='.repeat(80)}`);
        
        console.log('\n📦 Domains in cycle:');
        cycle.domains.forEach((domainId, i) => {
          const domainData = this.domains.get(domainId);
          const arrow = i < cycle.domains.length - 1 ? ' ↓' : ' ↩';
          console.log(`   ${i + 1}. ${domainId}${arrow}`);
          if (domainData) {
            console.log(`      File: ${domainData.filePath}`);
          }
        });
        
        if (cycle.closingRef) {
          console.log('\n🔗 Closing reference:');
          console.log(`   FQID: ${cycle.closingRef.fullFQID}`);
          console.log(`   Path: ${cycle.closingRef.propertyPath}`);
          console.log(`   File: ${cycle.closingRef.filePath}`);
          console.log(`   From: ${cycle.closingRef.sourceDomainId}`);
          console.log(`   To: ${cycle.closingRef.targetDomainId}`);
        }
        
        console.log('\n📎 All FQID references in cycle:');
        this.printCycleReferences(cycle);
      }
    });
    
    if (briefMode) {
      console.log('\n💡 Use without --brief for detailed FQID information');
    }
  }

  printCycleReferences(cycle) {
    const cycleDomains = new Set(cycle.domains);
    
    for (const domainId of cycle.domains) {
      const domainData = this.domains.get(domainId);
      if (!domainData) continue;
      
      for (const ref of domainData.fqidRefs) {
        if (cycleDomains.has(ref.targetDomainId)) {
          console.log(`\n   ${ref.sourceDomainId} → ${ref.targetDomainId}`);
          console.log(`   FQID: ${ref.fullFQID}`);
          console.log(`   Path: ${ref.propertyPath}`);
          console.log(`   File: ${ref.filePath}`);
        }
      }
    }
  }

  generateJSONReport(cycles, briefMode = false) {
    const report = {
      generatedAt: new Date().toISOString(),
      rootDirectory: this.rootDir,
      stats: this.stats,
      cyclesCount: cycles.length,
      briefMode: briefMode,
      cycles: cycles.map((cycle, index) => {
        const cycleData = {
          id: index + 1,
          domains: cycle.domains.map(domainId => {
            const domainData = this.domains.get(domainId);
            return {
              id: domainId,
              name: domainData ? domainData.name : domainId,
              filePath: domainData ? domainData.filePath : null
            };
          })
        };
        
        if (!briefMode) {
          cycleData.closingRef = cycle.closingRef;
          cycleData.references = this.getCycleReferences(cycle);
        }
        
        return cycleData;
      })
    };
    
    return JSON.stringify(report, null, 2);
  }

  getCycleReferences(cycle) {
    const cycleDomains = new Set(cycle.domains);
    const references = [];
    
    for (const domainId of cycle.domains) {
      const domainData = this.domains.get(domainId);
      if (!domainData) continue;
      
      for (const ref of domainData.fqidRefs) {
        if (cycleDomains.has(ref.targetDomainId)) {
          references.push(ref);
        }
      }
    }
    
    return references;
  }

  parseLenientYaml(content) {
    const lenientSchema = yaml.DEFAULT_SCHEMA.extend({
      implicit: [
        new yaml.Type('tag:yaml.org,2002:str', {
          kind: 'scalar',
          resolve: () => true,
          construct: (data) => data || ''
        })
      ]
    });
    
    const handleUnknownTag = (tag) => {
      return new yaml.Type(tag, {
        kind: 'scalar',
        resolve: () => true,
        construct: (data) => data
      });
    };
    
    const tagRegex = /![\w-]+/g;
    const tags = new Set();
    let match;
    while ((match = tagRegex.exec(content)) !== null) {
      tags.add(match[0]);
    }
    
    for (const tag of tags) {
      if (tag !== '!') {
        lenientSchema.explicit.push(handleUnknownTag(`tag:yaml.org,2002:${tag.slice(1)}`));
        lenientSchema.explicit.push(handleUnknownTag(tag));
      }
    }
    
    return yaml.load(content, { schema: lenientSchema });
  }

  cleanYamlContent(content) {
    const lines = content.split('\n');
    const cleanedLines = [];
    
    for (let line of lines) {
      line = line.replace(/![\w-]+/g, '');
      line = line.replace(/[*&]/g, '');
      
      if (line.includes('!!binary') || line.includes('!!python')) {
        continue;
      }
      
      cleanedLines.push(line);
    }
    
    return cleanedLines.join('\n');
  }
}

// CLI entry point
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node find-cycles.js <directory-path> [options]');
    console.error('Options:');
    console.error('  --json              Output JSON report');
    console.error('  --brief             Brief output (only domain names)');
    console.error('  --output <file>     Save report to file');
    console.error('  --help              Show this help');
    process.exit(1);
  }
  
  if (args.includes('--help')) {
    console.log('Usage: node find-cycles.js <directory-path> [options]');
    console.log('\nOptions:');
    console.log('  --json              Output JSON report instead of console output');
    console.log('  --brief             Brief output (only domain names without FQID details)');
    console.log('  --output <file>     Save report to specified file');
    console.log('  --help              Show this help');
    console.log('\nExamples:');
    console.log('  node find-cycles.js ./domains');
    console.log('  node find-cycles.js ./domains --brief');
    console.log('  node find-cycles.js ./domains --json');
    console.log('  node find-cycles.js ./domains --brief --json');
    console.log('  node find-cycles.js ./domains --json --output cycles.json');
    console.log('  node find-cycles.js ./domains --brief --output cycles.txt');
    process.exit(0);
  }
  
  const rootDir = path.resolve(args[0]);
  const useJson = args.includes('--json');
  const briefMode = args.includes('--brief');
  
  let outputFile = null;
  const outputIndex = args.indexOf('--output');
  if (outputIndex !== -1 && outputIndex + 1 < args.length) {
    outputFile = args[outputIndex + 1];
  }
  
  if (!fs.existsSync(rootDir)) {
    console.error(`❌ Directory does not exist: ${rootDir}`);
    process.exit(1);
  }
  
  const detector = new CycleDetector(rootDir);
  const cycles = detector.analyze();
  
  if (useJson) {
    const jsonReport = detector.generateJSONReport(cycles, briefMode);
    
    if (outputFile) {
      fs.writeFileSync(outputFile, jsonReport, 'utf8');
      console.log(`📄 JSON report saved to: ${outputFile}`);
    } else {
      console.log(jsonReport);
    }
  } else {
    detector.printCycles(cycles, briefMode);
    
    if (outputFile) {
      const textReport = generateTextReport(detector, cycles, briefMode);
      fs.writeFileSync(outputFile, textReport, 'utf8');
      console.log(`\n📄 Text report saved to: ${outputFile}`);
    }
  }
}

function generateTextReport(detector, cycles, briefMode = false) {
  let report = `Cyclic Dependencies Report\n`;
  report += `Generated: ${new Date().toISOString()}\n`;
  report += `Root Directory: ${detector.rootDir}\n`;
  report += `Cycles Found: ${cycles.length}\n`;
  report += `Mode: ${briefMode ? 'Brief' : 'Detailed'}\n\n`;
  
  cycles.forEach((cycle, index) => {
    if (briefMode) {
      report += `${index + 1}. ${cycle.domains.join(' ⇄ ')}\n`;
    } else {
      report += `${'='.repeat(80)}\n`;
      report += `Cycle #${index + 1}\n`;
      report += `${'='.repeat(80)}\n`;
      report += `Domains: ${cycle.domains.join(' → ')}\n\n`;
      
      if (cycle.closingRef) {
        report += `Closing Reference:\n`;
        report += `  FQID: ${cycle.closingRef.fullFQID}\n`;
        report += `  Path: ${cycle.closingRef.propertyPath}\n`;
        report += `  File: ${cycle.closingRef.filePath}\n\n`;
      }
      
      report += `All References:\n`;
      const refs = detector.getCycleReferences(cycle);
      refs.forEach(ref => {
        report += `  ${ref.sourceDomainId} → ${ref.targetDomainId}\n`;
        report += `    FQID: ${ref.fullFQID}\n`;
        report += `    Path: ${ref.propertyPath}\n`;
        report += `    File: ${ref.filePath}\n`;
      });
      report += '\n';
    }
  });
  
  return report;
}

if (require.main === module) {
  main();
}

module.exports = CycleDetector;