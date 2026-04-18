const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\sohan\\Downloads\\AlphaOps software - global - Copy (2)\\apps\\desktop\\index.html', 'utf8');
const lines = content.split('\n');
for (let i = 10300; i < 10500; i++) {
    const b = (lines[i].match(/`/g) || []).length;
    if (b > 0) {
        console.log(`L${i + 1} [${b}]: ${lines[i].trim()}`);
    }
}
