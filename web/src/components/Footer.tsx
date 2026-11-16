export function Footer({ version }: { version: string | null }) {
  return (
    <footer className="footer">
      <p>
        <strong>aidlc-ui</strong>, a visual companion for AWS AI-DLC workflows{version ? ` · v${version}` : ""}
      </p>
      <p>Created by Shaked Braimok Yosef · Built at Senora</p>
      <p className="muted">Independent community project. Not an official AWS product. Read-only: nothing here changes your workspace.</p>
    </footer>
  );
}
