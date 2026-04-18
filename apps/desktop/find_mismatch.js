const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\sohan\\Downloads\\Devyntra software - global - Copy (2)\\apps\\desktop\\index.html', 'utf8');
let inTemplate = false;
let startLine = -1;
let lineNum = 1;
const pairs = [];
for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineNum++;
    if (content[i] === '`') {
        inTemplate = !inTemplate;
        if (inTemplate) {
            startLine = lineNum;
        } else {
            pairs.push({ start: startLine, end: lineNum });
            startLine = -1;
        }
    }
}
if (inTemplate) {
    console.log('UNCLOSED Template starting at line:', startLine);
} else {
    console.log('All closed. Pairs:', pairs.length);
}

// Check for overlaps? No strings in JS can't overlap in that way.

// Wait, what if there's a backtick INSIDE a template but not escaped?
// That would just close it.
