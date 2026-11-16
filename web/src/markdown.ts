/**
 * Markdown rendering for UNTRUSTED artifact text (pure module, unit-tested).
 *  - raw HTML disabled (escaped, never parsed);
 *  - javascript:/vbscript:/data:/file: links dropped;
 *  - external links get target=_blank + rel=noopener noreferrer nofollow;
 *  - relative links are marked for in-app navigation;
 *  - images are never fetched (placeholder only).
 */
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false });

md.validateLink = (url: string) => {
  const u = url.trim().toLowerCase();
  if (/^(javascript|vbscript|data|file):/.test(u)) return false;
  return true;
};

md.renderer.rules.image = (tokens, idx) => {
  const t = tokens[idx];
  const alt = md.utils.escapeHtml(t.content || t.attrGet("alt") || "image");
  const src = md.utils.escapeHtml(t.attrGet("src") ?? "");
  return `<span class="md-image" title="Images are not loaded: ${src}">[image: ${alt}]</span>`;
};

const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const t = tokens[idx];
  const hrefAttr = t.attrGet("href") ?? "";
  if (/^(https?:|mailto:)/i.test(hrefAttr)) {
    t.attrSet("target", "_blank");
    t.attrSet("rel", "noopener noreferrer nofollow");
    t.attrJoin("class", "md-external");
  } else if (hrefAttr.startsWith("#")) {
    t.attrSet("data-anchor", hrefAttr.slice(1));
  } else {
    t.attrSet("data-relative", hrefAttr);
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// Wrap tables for horizontal scrolling on narrow screens.
md.renderer.rules.table_open = () => '<div class="md-table"><table>';
md.renderer.rules.table_close = () => "</table></div>";

export function renderMarkdown(text: string): string {
  return md.render(text);
}
