const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\sohan\\Downloads\\Devyntra software - global - Copy (2)\\apps\\desktop\\index.html', 'utf8');
let inTemplate = false;
let startLine = -1;
let lineNum = 1;
for (let i = 0; i < content.length; i++) {
    if (content[i] === '`') {
        inTemplate = !inTemplate;
        if (inTemplate) {
            startLine = lineNum;
        } else {
            startLine = -1;
        }
    }
    if (content[i] === '\n') lineNum++;
}
if (inTemplate) {
    console.log('UNCLOSED template started at line:', startLine);
} else {
    console.log('All templates are balanced.');
}
