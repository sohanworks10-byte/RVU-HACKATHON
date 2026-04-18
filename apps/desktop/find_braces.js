const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\sohan\\Downloads\\AlphaOps software - global - Copy (2)\\apps\\desktop\\index.html', 'utf8');
const lines = content.split('\n');
let balance = 0;
for (let i = 10325; i < 10398; i++) { // Lines 10326 to 10398
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
        if (line[j] === '{') balance++;
        if (line[j] === '}') balance--;
    }
}
console.log('Balance of updateDashboardActivityLog:', balance);
