const fs = require('fs');
const path = require('path');

const dirs = [
  'src/components/admin',
  'src/routes/admin'
];

const replacements = [
  { regex: /bg-black/g, replace: 'bg-background' },
  { regex: /bg-\[#050505\]/g, replace: 'bg-surface' },
  { regex: /bg-\[#0a0a0a\]/g, replace: 'bg-surface-2' },
  { regex: /bg-\[#111\]/g, replace: 'bg-muted' },
  { regex: /bg-\[#1a1a1a\]/g, replace: 'bg-muted/80' },
  
  { regex: /border-\[#1a1a1a\]/g, replace: 'border-border' },
  { regex: /border-\[#111\]/g, replace: 'border-border/50' },
  { regex: /border-\[#222\]/g, replace: 'border-border/80' },
  
  { regex: /divide-\[#111\]/g, replace: 'divide-border/50' },
  
  { regex: /text-white/g, replace: 'text-foreground' },
  { regex: /text-black/g, replace: 'text-background' },
  { regex: /bg-white/g, replace: 'bg-foreground' },
  
  { regex: /text-zinc-300/g, replace: 'text-foreground\/90' },
  { regex: /text-zinc-400/g, replace: 'text-foreground\/80' },
  { regex: /text-zinc-500/g, replace: 'text-muted-foreground' },
  { regex: /text-zinc-600/g, replace: 'text-muted-foreground\/80' },
  { regex: /text-zinc-700/g, replace: 'text-muted-foreground\/60' },
  { regex: /text-zinc-800/g, replace: 'text-muted-foreground\/40' }
];

function processDir(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let original = content;
      
      for (const { regex, replace } of replacements) {
        content = content.replace(regex, replace);
      }
      
      if (content !== original) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log('Updated', fullPath);
      }
    }
  }
}

dirs.forEach(processDir);
console.log('Done');
