const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\sohan\\Downloads\\AlphaOps software - global - Copy (2)\\apps\\desktop\\index.html', 'utf8');
const counts = {};
let inTemplate = false;
let lineNum = 1;
for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineNum++;
    if (content[i] === '`') {
        inTemplate = !inTemplate;
        if (inTemplate) {
            counts[lineNum] = (counts[lineNum] || 0) + 1;
        } else {
            counts[lineNum] = (counts[lineNum] || 0) + 1;
        }
    }
}
let total = 0;
for (let line in counts) {
    total += counts[line];
    if (counts[line] % 2 !== 0) {
        console.log('Line', line, 'has', counts[line], 'backticks');
    }
}
console.log('Total backticks:', total);
