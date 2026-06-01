// Minimal allowlist HTML sanitizer for book descriptions returned by enrichment.
// Strips everything except a handful of structural inline/block tags. Drops
// all attributes (Open Library descriptions don't need them), then renders via
// dangerouslySetInnerHTML.

const ALLOWED = new Set([
  "p", "br", "em", "i", "strong", "b", "u", "h3", "h4", "h5",
  "blockquote", "ul", "ol", "li", "span",
]);

export function sanitizeDescription(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = input.trim();
  // If it doesn't look like HTML, just escape and wrap in <p>.
  if (!/<\w+/.test(trimmed)) {
    return `<p>${escapeText(trimmed)}</p>`;
  }
  const doc = new DOMParser().parseFromString(trimmed, "text/html");
  const out = walk(doc.body);
  // Collapse runs of empty paragraphs that the source HTML often leaves behind.
  return out.replace(/(<p>\s*<\/p>)+/g, "").trim();
}

function walk(node: Node): string {
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += escapeText(child.textContent ?? "");
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      const inner = walk(el);
      if (ALLOWED.has(tag)) {
        if (tag === "br") {
          out += "<br/>";
        } else if (inner.trim() === "" && tag !== "li") {
          // skip empties
        } else {
          out += `<${tag}>${inner}</${tag}>`;
        }
      } else {
        out += inner;
      }
    }
  });
  return out;
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
