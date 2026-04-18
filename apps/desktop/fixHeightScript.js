const fs = require('fs');

try {
    let html = fs.readFileSync('index.html', 'utf8');

    const regex = /<div class="w-full h-full bg-white flex flex-col font-sans overflow-hidden fade-in relative">/g;
    
    if (!regex.test(html)) {
        console.error("Match not found!");
        process.exit(1);
    }
    
    // Use an explicit height, negative margins to break out of container padding
    // and rounded corners with a subtle shadow to make it pop like a modern chat interface
    const replacement = `<div class="w-full flex flex-col font-sans overflow-hidden fade-in relative bg-white md:rounded-[2rem] border border-gray-100 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.05)]" style="height: calc(100vh - 120px);">`;

    html = html.replace(regex, replacement);
    fs.writeFileSync('index.html', html);
    console.log("Successfully fixed alphainfra container layout!");
} catch (e) {
    console.error(e);
}
