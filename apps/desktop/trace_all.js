const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\sohan\\Downloads\\AlphaOps software - global - Copy (2)\\apps\\desktop\\index.html', 'utf8');
let inTemplate = false;
let startLine = -1;
let lineNum = 1;
console.log('--- STARTING TRACE ---');
for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineNum++;
    if (content[i] === '`') {
        inTemplate = !inTemplate;
        if (inTemplate) {
            console.log(`Open at ${lineNum}`);
        } else {
            console.log(`Close at ${lineNum}`);
        }
    }
}
