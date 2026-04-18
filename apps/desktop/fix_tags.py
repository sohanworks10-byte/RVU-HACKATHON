
import os

file_path = r'c:\Users\sohan\Downloads\Devyntra software - global - Copy (2)\apps\desktop\index.html'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix common broken tags
# These patterns are likely caused by a model trying to espace or being too helpful with spaces
replacements = [
    ('< div', '<div'),
    ('< /div', '</div>'),
    ('< span', '<span'),
    ('< /span', '</span>'),
    ('< p', '<p'),
    ('< /p', '</p'),
    ('< h1', '<h1'),
    ('< /h1', '</h1>'),
    ('< h2', '<h2'),
    ('< /h2', '</h2>'),
    ('< h3', '<h3'),
    ('< /h3', '</h3>'),
    ('< h4', '<h4'),
    ('< /h4', '</h4>'),
    ('< i', '<i'),
    ('< /i', '</i>'),
    ('< !--', '<!--'),
    ('-- >', '-->'),
    (' >', '>') # Be careful with this one, but usually tags are " >" when broken
]

for old, new in replacements:
    content = content.replace(old, new)

# specifically check for the ones in the screenshot
# < div class="flex flex-col gap-6 h-full" >
# < !--Hero Section(Refined Sunset Minimalist)-- >
content = content.replace('< div class="flex flex-col gap-6 h-full" >', '<div class="flex flex-col gap-6 h-full">')
content = content.replace('< !--Hero Section(Refined Sunset Minimalist)-- >', '<!--Hero Section(Refined Sunset Minimalist)-->')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed common tag spacing issues.")
