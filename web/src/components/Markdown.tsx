import { renderMarkdown } from "../markdown";
import { useMemo } from "react";

/**
 * Renders artifact Markdown as UNTRUSTED content:
 *  - raw HTML is disabled (escaped, never parsed);
 *  - links: only http(s)/mailto and relative links survive markdown-it's
 *    validateLink; relative links are turned into in-app navigation by the
 *    caller via `onNavigate`; external links open in a new tab with
 *    noopener/noreferrer;
 *  - images are never fetched: they become a labelled placeholder (no
 *    network requests to third parties, no tracking pixels);
 *  - the page CSP forbids inline scripts regardless.
 */
export function Markdown({ text, onRelativeLink }: { text: string; onRelativeLink?: (href: string) => void }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      className="markdown"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (!a) return;
        const rel = a.getAttribute("data-relative");
        if (rel !== null) {
          e.preventDefault();
          onRelativeLink?.(rel);
        }
        const anchor = a.getAttribute("data-anchor");
        if (anchor !== null) e.preventDefault();
      }}
      // markdown-it with html:false escapes all raw HTML in the source.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
