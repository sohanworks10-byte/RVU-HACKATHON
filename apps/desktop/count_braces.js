const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\sohan\\Downloads\\AlphaOps software - global - Copy (2)\\apps\\desktop\\index.html', 'utf8');
const c1 = (content.match(/\{/g) || []).length;
const c2 = (content.match(/\}/g) || []).length;
console.log('{:', c1);
console.log('}:', c2);
console.log('diff:', c1 - c2);
const b1 = (content.match(/`/g) || []).length;
console.log('backticks:', b1);
