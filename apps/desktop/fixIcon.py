import re

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Replace the sparkles icon with robot
new_html = html.replace('<i class="fas fa-sparkles text-xs"></i>', '<i class="fas fa-robot text-[14px]"></i>')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(new_html)

print("Icon replaced!")
