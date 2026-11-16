import { useEffect, useState } from "react";

/**
 * Hash routes:
 *   #/                                     home (workspace list / onboarding)
 *   #/w/:ws                                workspace overview
 *   #/w/:ws/connection                     connection & compatibility
 *   #/w/:ws/i/:space/:intent/:tab?         intent (tab: workflow|decisions|timeline|artifacts)
 * Query (after "?"): stage=<slug>, file=<path>
 */
export interface Route {
  name: "home" | "workspace" | "connection" | "intent";
  ws?: string;
  space?: string;
  intent?: string;
  tab?: "workflow" | "decisions" | "timeline" | "artifacts";
  query: URLSearchParams;
}

export function parseRoute(hash: string): Route {
  const [pathPart, queryPart = ""] = hash.replace(/^#/, "").split("?");
  const parts = pathPart.split("/").filter(Boolean).map(decodeURIComponent);
  const query = new URLSearchParams(queryPart);
  if (parts[0] === "w" && parts[1]) {
    if (parts[2] === "connection") return { name: "connection", ws: parts[1], query };
    if (parts[2] === "i" && parts[3] && parts[4]) {
      const tab = (["workflow", "decisions", "timeline", "artifacts"] as const).find((t) => t === parts[5]) ?? "workflow";
      return { name: "intent", ws: parts[1], space: parts[3], intent: parts[4], tab, query };
    }
    return { name: "workspace", ws: parts[1], query };
  }
  return { name: "home", query };
}

export function href(r: Partial<Route> & { name: Route["name"] }, query?: Record<string, string | undefined>): string {
  const e = encodeURIComponent;
  let p = "#/";
  if (r.name === "workspace") p = `#/w/${e(r.ws!)}`;
  if (r.name === "connection") p = `#/w/${e(r.ws!)}/connection`;
  if (r.name === "intent") p = `#/w/${e(r.ws!)}/i/${e(r.space!)}/${e(r.intent!)}/${r.tab ?? "workflow"}`;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `${p}?${qs}` : p;
}

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", on);
    window.addEventListener("popstate", on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("popstate", on);
    };
  }, []);
  return route;
}
