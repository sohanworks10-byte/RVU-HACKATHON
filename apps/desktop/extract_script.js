const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\sohan\\Downloads\\AlphaOps software - global - Copy (2)\\apps\\desktop\\index.html', 'utf8');
const lines = content.split('\n');

let start = 0;
let end = 0;
// find max consecutive segment without <script> or </script>
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<script>') && !lines[i].includes('src=')) start = i + 1;
    if (lines[i].includes('</script>') && start > 0) {
        end = i;
        if (end - start > 1000) break;
    }
}
console.log('Script block from', start, 'to', end);

const scriptContent = lines.slice(start, end).join('\n');
fs.writeFileSync('c:\\Users\\sohan\\Downloads\\AlphaOps software - global - Copy (2)\\apps\\desktop\\test_script.js', scriptContent);
