import re

with open('apps/desktop/index.html', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# Find and replace the monitoring section
old_pattern = r"(                    if \(viewName === 'monitoring'\) \{\s*\n)(\s*if \(typeof loadMonitoring === 'function'\) \{)"
new_text = r"\1\n                        // FIX: Build DOM immediately so UI is ready before data loads\n                        if (typeof ensureMonitoringDOM === 'function') {\n                            ensureMonitoringDOM();\n                        }\n\n\2"

content_new = re.sub(old_pattern, new_text, content)

if content_new != content:
    with open('apps/desktop/index.html', 'w', encoding='utf-8') as f:
        f.write(content_new)
    print("Fixed monitoring load sequence - added ensureMonitoringDOM() call")
else:
    print("Pattern not found - may already be fixed or structure changed")
