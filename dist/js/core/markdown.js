// Small, escaped Markdown renderer for local project documentation.
// Raw HTML is displayed as text. Links allow only web URLs and known local docs.
import { esc } from "./utils.js";

function linkTarget(href) {
  if (/^https?:\/\//i.test(href)) return href;
  const documents = {
    "docs/API.md": "api",
    "API.md": "api",
    "README.md": "readme",
    "STRUCTURE.md": "structure",
    "docs/STRUCTURE.md": "structure",
    "docs/ALARMS.md": "alarms",
    "docs/SECURITY.md": "security",
    "SECURITY.md": "security",
    "ALARMS.md": "alarms",
  };
  return documents[href] ? "#guides/" + documents[href] : null;
}

function inline(text) {
  const tokens = [];
  const token = (html) => {
    tokens.push(html);
    return `\u0000${tokens.length - 1}\u0000`;
  };
  let result = text.replace(/`([^`]+)`/g, (_, code) =>
    token(`<code>${esc(code)}</code>`),
  );
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const target = linkTarget(href);
    return token(
      target
        ? `<a href="${esc(target)}" ${target.startsWith("http") ? 'target="_blank" rel="noopener noreferrer"' : ""}>${esc(label)}</a>`
        : esc(label),
    );
  });
  result = esc(result).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return result.replace(
    /\u0000(\d+)\u0000/g,
    (_, index) => tokens[Number(index)] || "",
  );
}

export function markdown(content) {
  const lines = content.replace(/\r/g, "").split("\n");
  const output = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code = [];
      index++;
      while (index < lines.length && !lines[index].startsWith("```"))
        code.push(lines[index++]);
      index++;
      output.push(
        `<div class="doc-code"><small>${esc(language || "Kód")}</small><pre><code>${esc(code.join("\n"))}</code></pre></div>`,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index++;
      continue;
    }
    if (
      line.startsWith("|") &&
      /^\|[\s:|\-]+\|$/.test(lines[index + 1] || "")
    ) {
      const cells = (text) =>
        text
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((value) => inline(value.trim()));
      const headers = cells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].startsWith("|"))
        rows.push(cells(lines[index++]));
      output.push(
        `<div class="tablewrap"><table><thead><tr>${headers.map((value) => `<th>${value}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
      );
      continue;
    }
    const ordered = /^\d+\.\s/.test(line);
    if (ordered || /^[-*]\s/.test(line)) {
      const tag = ordered ? "ol" : "ul";
      const pattern = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      const items = [];
      while (index < lines.length && pattern.test(lines[index]))
        items.push(inline(lines[index++].replace(pattern, "")));
      output.push(
        `<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`,
      );
      continue;
    }
    const paragraph = [line];
    index++;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#|```|\||[-*]\s|\d+\.\s)/.test(lines[index])
    )
      paragraph.push(lines[index++]);
    output.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  return output.join("\n");
}
