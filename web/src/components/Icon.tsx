/** Small inline icon set (stroke icons, currentColor). Decorative unless a label is given. */
const PATHS: Record<string, string> = {
  check: "M5 12.5l4.2 4.2L19 7",
  dot: "M12 12h.01",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  gate: "M12 3l8 4v5c0 4.6-3.4 8.4-8 9-4.6-.6-8-4.4-8-9V7l8-4zM12 8v5M12 16h.01",
  revise: "M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4",
  skip: "M5 5l14 14M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  question: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 17.5h.01",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  copy: "M9 9h10v10H9zM5 15V5h10",
  refresh: "M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4",
  plug: "M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v5",
  warning: "M12 4l9 16H3l9-16zM12 10v4M12 17h.01",
  info: "M12 8h.01M11 12h1v5h1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  close: "M6 6l12 12M18 6L6 18",
  chevron: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 8v4l3 2",
  chat: "M4 5h16v11H8l-4 4V5z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  code: "M8 8l-4 4 4 4M16 8l4 4-4 4",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  shield: "M12 3l8 4v5c0 4.6-3.4 8.4-8 9-4.6-.6-8-4.4-8-9V7l8-4z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  plus: "M12 5v14M5 12h14",
  menu: "M4 7h16M4 12h16M4 17h16",
};

export function Icon({ name, size = 16, label, className }: { name: keyof typeof PATHS | string; size?: number; label?: string; className?: string }) {
  return (
    <svg
      className={`icon ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "dot" ? 6 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name] ?? PATHS.dot} />
    </svg>
  );
}
