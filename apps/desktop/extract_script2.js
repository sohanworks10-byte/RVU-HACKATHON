const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\sohan\\Downloads\\Devyntra software - global - Copy (2)\\apps\\desktop\\index.html', 'utf8');
const lines = content.split('\n');

let start = 0;
let end = 0;
// find second <script> block
let count = 0;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<script>') && !lines[i].includes('src=')) {
        count++;
        if (count === 2) {
            start = i + 1;
        }
    }
    if (lines[i].includes('</script>') && start > 0 && count === 2) {
        end = i;
        break;
    }
}
console.log('Script block from', start + 1, 'to', end + 1);

const scriptContent = lines.slice(start, end).join('\n');
fs.writeFileSync('c:\\Users\\sohan\\Downloads\\Devyntra software - global - Copy (2)\\apps\\desktop\\test_script2.js', scriptContent);
