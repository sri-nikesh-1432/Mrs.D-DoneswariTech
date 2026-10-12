import re
from typing import List, Dict, Any


def clean_pages(pages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned = []

    for page in pages:
        text = page["text"]
        lines = text.split("\n")
        cleaned_lines = []

        for line in lines:
            line = line.strip()
            if not line:
                continue
            # Skip pure page numbers
            if re.match(r'^\d+$', line):
                continue
            # Skip very short lines (likely headers/footers)
            if len(line) < 4:
                continue
            cleaned_lines.append(line)

        text = "\n".join(cleaned_lines)
        # Normalize whitespace
        text = re.sub(r' {2,}', ' ', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        # Normalize currency symbols
        text = text.replace('Rs.', '₹').replace('Rs ', '₹').replace('INR ', '₹')
        # Remove OCR artifacts / control characters
        text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)

        if text.strip():
            cleaned.append({**page, "text": text.strip()})

    return cleaned
