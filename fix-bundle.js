const fs = require('fs');
const path = require('path');

const bundlePath = path.join(__dirname, 'modules', 'index.js');
let content = fs.readFileSync(bundlePath, 'utf8');

console.log('Original length:', content.length);

// Use regex to remove lines starting with exports or defineProperty
content = content.replace(/^.*exports\..*$/gm, '');
content = content.replace(/^.*Object\.defineProperty\(exports.*$/gm, '');
content = content.replace(/'use strict';/g, '');

// Aggressively remove any remaining 'exports.' strings
content = content.replace(/exports\./g, '');

// Clean up extra double newlines
content = content.replace(/\n\s*\n/g, '\n');

fs.writeFileSync(bundlePath, content);
console.log('Bundle fixed successfully. New length:', content.length);
