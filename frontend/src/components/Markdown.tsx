import React from "react";

/**
 * Lightweight Markdown renderer for AI message bubbles.
 * Supports: bold, italic, inline code, fenced code blocks, bullet/numbered
 * lists, simple tables, and line breaks. No external dependency needed.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMarkdown(text: string): string {
  let html = escapeHtml(text);
  // Inline code first (protects content inside backticks)
  html = html.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Italic
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return html;
}

function renderTable(lines: string[]): string {
  const rows = lines.map((l) =>
    l
      .split("|")
      .map((c) => c.trim())
      .filter((c, i, arr) => !(i === 0 && c === "") && !(i === arr.length - 1 && c === ""))
  );
  const header = rows[0] || [];
  const body = rows.slice(2).filter((r) => r.length > 0); // skip separator row
  const thead = `<thead><tr>${header
    .map((h) => `<th>${inlineMarkdown(h)}</th>`)
    .join("")}</tr></thead>`;
  const tbody = `<tbody>${body
    .map(
      (r) =>
        `<tr>${r.map((c) => `<td>${inlineMarkdown(c)}</td>`).join("")}</tr>`
    )
    .join("")}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

export default function Markdown({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const blocks = text.split(/\n{2,}/);

  blocks.forEach((block, blockIdx) => {
    const trimmed = block.trim();

    // Fenced code block
    if (trimmed.startsWith("```")) {
      const content = trimmed.replace(/^```[a-zA-Z0-9_-]*\n?/, "").replace(/```$/, "");
      parts.push(
        <pre key={blockIdx} className="bg-black/40 border border-white/10 rounded-xl p-4 overflow-x-auto text-sm my-2">
          <code className="font-mono text-emerald-300">{content}</code>
        </pre>
      );
      return;
    }

    // Table: contains | and a separator row of dashes
    const blockLines = block.split("\n");
    const isTable =
      blockLines.length >= 2 &&
      blockLines.some((l) => l.includes("|")) &&
      blockLines.some((l) => /^\s*\|?[\s:-]+\|[\s:-]*\|?\s*$/.test(l.trim()));
    if (isTable) {
      parts.push(
        <div
          key={blockIdx}
          className="overflow-x-auto my-2"
          dangerouslySetInnerHTML={{ __html: renderTable(blockLines) }}
        />
      );
      return;
    }

    // Lists
    const listItems = blockLines.filter((l) => /^\s*[-*•]\s+/.test(l));
    if (listItems.length > 1 && listItems.length === blockLines.filter((l) => l.trim()).length) {
      parts.push(
        <ul key={blockIdx} className="list-disc list-inside space-y-1 my-2 text-sm">
          {listItems.map((li, i) => (
            <li
              key={i}
              dangerouslySetInnerHTML={{ __html: inlineMarkdown(li.replace(/^\s*[-*•]\s+/, "")) }}
            />
          ))}
        </ul>
      );
      return;
    }

    const numberedItems = blockLines.filter((l) => /^\s*\d+[.)]\s+/.test(l));
    if (numberedItems.length > 1 && numberedItems.length === blockLines.filter((l) => l.trim()).length) {
      parts.push(
        <ol key={blockIdx} className="list-decimal list-inside space-y-1 my-2 text-sm">
          {numberedItems.map((li, i) => (
            <li
              key={i}
              dangerouslySetInnerHTML={{ __html: inlineMarkdown(li.replace(/^\s*\d+[.)]\s+/, "")) }}
            />
          ))}
        </ol>
      );
      return;
    }

    // Single line (or paragraph)
    const lines = blockLines.map((l) => l.trim()).filter(Boolean);
    if (lines.length === 1) {
      parts.push(
        <p
          key={blockIdx}
          className="text-sm leading-relaxed my-1"
          dangerouslySetInnerHTML={{ __html: inlineMarkdown(lines[0]) }}
        />
      );
    } else {
      parts.push(
        <div key={blockIdx} className="my-1">
          {lines.map((l, i) => (
            <p
              key={i}
              className="text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: inlineMarkdown(l) }}
            />
          ))}
        </div>
      );
    }
  });

  return (
    <div className="markdown-body text-sm leading-relaxed [&_code]:bg-black/40 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:font-mono [&_code]:text-xs [&_table]:w-full [&_th]:text-left [&_th]:p-2 [&_th]:border [&_th]:border-white/10 [&_th]:bg-white/5 [&_th]:text-xs [&_td]:p-2 [&_td]:border [&_td]:border-white/10 [&_td]:text-xs [&_tr]:border [&_tr]:border-white/10">
      {parts}
    </div>
  );
}
