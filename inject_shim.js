const fs = require('fs');
const files = [
    'index.html', 
    'auth.html', 
    'monitoring-modern.html', 
    'monitoring-standalone.html', 
    'splash.html', 
    'splash-and-skeleton-animations.html', 
    'monitoring-layout-new.html'
];
const shim = `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\n    <script src="web-shim.js"></script>`;

files.forEach(f => {
    try {
        const p = './apps/desktop/' + f;
        let content = fs.readFileSync(p, 'utf8');
        if (!content.includes('web-shim.js')) {
            content = content.replace('<head>', '<head>\n    ' + shim);
            fs.writeFileSync(p, content);
            console.log('Injected into ' + f);
        } else {
            console.log('Already injected in ' + f);
        }
    } catch(e) {
        console.error('Failed to inject into ' + f, e.message);
    }
});
