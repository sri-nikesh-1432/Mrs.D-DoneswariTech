"""Fix the broken else block indentation in conversation_routes.py"""
import re

with open('backend/app/api/conversation_routes.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the problematic area: the "else:" after cache check and everything that follows
# Strategy: find the line "sentence_q: asyncio.Queue = asyncio.Queue()" inside the else block
# and the next line "_l0 = time.time()" which is at the wrong indentation level

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # Find the sentence_q line that's indented at level 5 (20 spaces = else block)
    if '                    sentence_q: asyncio.Queue = asyncio.Queue()' in line:
        # Found the start of the else block content
        new_lines.append(line)
        i += 1
        
        # Now re-indent everything until we hit the "if stream_error:" line
        while i < len(lines):
            current = lines[i]
            stripped = current.lstrip()
            current_indent = len(current) - len(stripped)
            
            # Stop at "if stream_error:" which is at 16-space indent (outside the else)
            if stripped.startswith('if stream_error:'):
                new_lines.append(current)
                i += 1
                break
            
            # If this line is at 16-space indent (outside else block but should be inside)
            if current_indent == 16 and stripped and not stripped.startswith('#') and stripped != '\n':
                # Re-indent to 20 spaces (inside else block)
                new_lines.append('                    ' + stripped)
                i += 1
            else:
                new_lines.append(current)
                i += 1
        continue
    
    new_lines.append(line)
    i += 1

with open('backend/app/api/conversation_routes.py', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("OK: indentation fix applied")
