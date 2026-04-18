const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\sohan\\Downloads\\Devyntra software - global - Copy (2)\\apps\\desktop\\index.html', 'utf8');
let inTemplate = false;
let lineNum = 1;
for (let i = 0; i < content.length; i++) {
    if (content[i] === '`') inTemplate = !inTemplate;
    if (content[i] === '\n') {
        if (lineNum === 10402) {
            console.log('Line 10402 state: inTemplate =', inTemplate);
        }
        lineNum++;
    }
}
