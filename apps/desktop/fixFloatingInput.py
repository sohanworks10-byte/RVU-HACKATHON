import re

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Replace the h-full with explicit height and min-height
search_str = '<div class="flex-1 flex flex-col min-w-0 relative h-full bg-[#F9FAFB] font-sans overflow-hidden">'
replace_str = '<div class="flex-1 flex flex-col min-w-0 relative bg-[#F9FAFB] font-sans overflow-hidden" style="height: calc(100vh - 65px); min-height: calc(100vh - 65px);">'

# If I can't find it exactly, I'll regex it
if search_str in html:
    html = html.replace(search_str, replace_str)
    print("Direct replacement complete!")
else:
    print("Exact search string not found, trying regex...")
    pattern = r'<div class="flex-1 flex flex-col min-w-0 relative h-full bg-\[\#F9FAFB\] font-sans overflow-hidden">'
    html, count = re.subn(pattern, replace_str, html)
    print(f"Regex replacement performed {count} times.")

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)
