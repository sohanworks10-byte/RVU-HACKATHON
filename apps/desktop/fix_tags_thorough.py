
import os
import re

file_path = r'c:\Users\sohan\Downloads\Devyntra software - global - Copy (2)\apps\desktop\index.html'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix < tag, < !--, < / tag
content = re.sub(r'<\s+([a-zA-Z/!])', r'<\1', content)
# Fix </ tag
content = re.sub(r'</\s+([a-zA-Z])', r'</\1', content)
# Fix <! --
content = re.sub(r'<!\s+--', r'<!--', content)
# Fix tag >
content = re.sub(r'([a-zA-Z"\'0-9\-])\s+>', r'\1>', content)
# Fix -- >
content = re.sub(r'--\s+>', r'-->', content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Applied thorough regex fix for tag spacing.")
