"""Fix the broken indentation in conversation_routes.py streaming section."""
with open('backend/app/api/conversation_routes.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# The issue: lines 324-438 are at indent 16 (4 tabs), but they should be
# at indent 20 (5 tabs) to be inside the else block.
# EXCEPTION: some lines after the streaming should stay at indent 16
# (they are shared by both cache hit and cache miss paths).

# Strategy: find the exact range and fix indentation
new_lines = []
i = 0
in_else_block = False

while i < len(lines):
    line = lines[i]
    stripped = line.rstrip('\r\n')
    current_indent = len(stripped) - len(stripped.lstrip()) if stripped.strip() else -1
    
    # Detect start of else block
    if stripped.strip() == 'else:' and current_indent == 16:
        in_else_block = True
        new_lines.append(line)
        i += 1
        continue
    
    # Detect end of else block: when we hit "if stream_error:" or "memory.append" at indent 16
    if in_else_block and current_indent == 16:
        s = stripped.strip()
        if s.startswith('if stream_error:') or s.startswith('memory.append'):
            in_else_block = False
            # Don't change this line - it stays at 16
            new_lines.append(line)
            i += 1
            continue
    
    # Inside the else block: re-indent lines at 16 to 20
    if in_else_block and current_indent == 16 and stripped.strip():
        # Add 4 spaces (from 16 to 20)
        new_lines.append('    ' + line)
        i += 1
        continue
    
    new_lines.append(line)
    i += 1

with open('backend/app/api/conversation_routes.py', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("OK: indentation fixed")
