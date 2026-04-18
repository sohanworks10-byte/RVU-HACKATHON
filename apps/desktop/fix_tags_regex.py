
import os
import re

file_path = r'c:\Users\sohan\Downloads\Devyntra software - global - Copy (2)\apps\desktop\index.html'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Pattern for < tag, < /tag, < !--
# We want to catch < followed by space and then a valid tag character (a-z, /, !)
content = re.sub(r'<\s+([a-zA-Z/!])', r'<\1', content)

# Pattern for tag >
# We want to catch space followed by > at the end of a tag.
# This is trickier because "a > b" is valid math.
# But in this file, we usually see things like <div ... >
# Let's target " >" that closes a tag.
# Usually tags are like <div ... > or </div>
content = re.sub(r'\s+>', r'>', content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Applied regex fix for tag spacing.")
