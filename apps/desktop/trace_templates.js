const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\sohan\\Downloads\\AlphaOps software - global - Copy (2)\\apps\\desktop\\index.html', 'utf8');
let inTemplate = false;
let startLine = -1;
let lineNum = 1;
for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineNum++;
    if (content[i] === '`') {
        if (!inTemplate) {
            inTemplate = true;
            startLine = lineNum;
        } else {
            inTemplate = false;
        }
    }
}
if (inTemplate) {
    console.log(`Unclosed template starting at ${startLine}`);
}
