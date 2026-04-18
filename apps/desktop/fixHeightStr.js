const fs = require('fs');

try {
    let html = fs.readFileSync('index.html', 'utf8');

    const regex = /<div class="w-full flex-1 flex flex-col font-sans overflow-hidden fade-in relative bg-white md:rounded-\[2\.5rem\] border border-gray-100 shadow-\[0_20px_50px_-15px_rgba\(0,0,0,0\.05\)\] mb-4">/g;
    
    const replacement = `<div class="w-full flex flex-col font-sans overflow-hidden fade-in relative bg-white md:rounded-[2.5rem] border border-gray-100 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.05)] mb-4" style="min-height: calc(100vh - 100px);">`;

    if(html.indexOf('<div class="w-full flex-1 flex flex-col font-sans overflow-hidden fade-in relative bg-white md:rounded-[2.5rem] border border-gray-100 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.05)] mb-4">') > -1) {
       html = html.replace('<div class="w-full flex-1 flex flex-col font-sans overflow-hidden fade-in relative bg-white md:rounded-[2.5rem] border border-gray-100 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.05)] mb-4">', replacement);
       fs.writeFileSync('index.html', html);
       console.log("Successfully fixed flex UI bugs and stuck UI to top.");
    } else {
       console.log("Exact string NOT found");
    }
} catch (e) {
    console.error(e);
}
