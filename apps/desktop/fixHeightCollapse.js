const fs = require('fs');

try {
    let html = fs.readFileSync('index.html', 'utf8');

    const regex = /<div class="w-full flex-1 flex flex-col font-sans overflow-hidden fade-in relative bg-white md:rounded-\[2\.5rem\] border border-gray-100 shadow-\[0_20px_50px_-15px_rgba\(0,0,0,0\.05\)\] mb-4">/g;
    
    if (!regex.test(html)) {
        console.error("Match not found!");
        process.exit(1);
    }
    
    // Add an explicit height to prevent flex collapse
    const replacement = `<div class="w-full flex flex-col font-sans overflow-hidden fade-in relative bg-white md:rounded-[2.5rem] border border-gray-100 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.05)] mb-4" style="height: calc(100vh - 120px);">`;

    html = html.replace(regex, replacement);
    fs.writeFileSync('index.html', html);
    console.log("Successfully fixed alphainfra height collapse!");
} catch (e) {
    console.error(e);
}
