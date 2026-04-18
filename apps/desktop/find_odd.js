const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\sohan\\Downloads\\Devyntra software - global - Copy (2)\\apps\\desktop\\index.html', 'utf8');
const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
    const b = (lines[i].match(/`/g) || []).length;
    if (b % 2 !== 0) {
        console.log('Line', i + 1, '(', b, 'backticks):', lines[i].trim());
    }
}
