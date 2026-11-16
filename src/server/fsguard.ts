/**
 * Read-only, root-confined filesystem access.
 *
 * Every read in aidlc-ui goes through a `RootFs`. It:
 *  - resolves paths relative to one connected workspace root;
 *  - rejects absolute paths, `..` traversal, NUL bytes and backslash tricks;
 *  - resolves symlinks with realpath and refuses anything whose real path
 *    leaves the root's real path (symlink escape);
 *  - never opens a file for writing (there is no write API at all);
 *  - bounds the bytes it reads.
 */
import { promises as fs, constants as fsc } from "node:fs";
import path from "node:path";

export class FsGuardError extends Error {
  constructor(message: string, readonly code: "outside-root" | "invalid-path" | "not-found" | "too-large" | "not-a-file") {
    super(message);
  }
}

export interface FileStat {
  rel: string;
  size: number;
  mtimeMs: number;
  isFile: boolean;
  isDir: boolean;
}

const MAX_DEFAULT = 4 * 1024 * 1024;

export class RootFs {
  private realRootPromise: Promise<string> | null = null;

  constructor(readonly root: string) {
    if (!path.isAbsolute(root)) throw new FsGuardError("workspace root must be absolute", "invalid-path");
  }

  realRoot(): Promise<string> {
    this.realRootPromise ??= fs.realpath(this.root);
    return this.realRootPromise;
  }

  /** Normalise a workspace-relative path; throws on anything suspicious. */
  static normalizeRel(rel: string): string {
    if (typeof rel !== "string") throw new FsGuardError("path must be a string", "invalid-path");
    if (rel.includes("\0")) throw new FsGuardError("path contains NUL", "invalid-path");
    const forward = rel.replace(/\\/g, "/");
    if (forward.startsWith("/") || /^[a-zA-Z]:/.test(forward)) {
      throw new FsGuardError("absolute paths are not accepted", "invalid-path");
    }
    const parts: string[] = [];
    for (const part of forward.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") throw new FsGuardError("path traversal is not allowed", "outside-root");
      parts.push(part);
    }
    return parts.join("/");
  }

  /** Resolve to a real absolute path inside the root, or throw. */
  async resolve(rel: string): Promise<string> {
    const norm = RootFs.normalizeRel(rel);
    const realRoot = await this.realRoot();
    const joined = path.join(realRoot, ...norm.split("/"));
    let real: string;
    try {
      real = await fs.realpath(joined);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new FsGuardError(`not found: ${norm}`, "not-found");
      throw err;
    }
    if (!isInside(realRoot, real)) {
      throw new FsGuardError(`refusing to follow a link outside the workspace: ${norm}`, "outside-root");
    }
    return real;
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await this.resolve(rel);
      return true;
    } catch {
      return false;
    }
  }

  async stat(rel: string): Promise<FileStat | null> {
    try {
      const real = await this.resolve(rel);
      const st = await fs.stat(real);
      return { rel: RootFs.normalizeRel(rel), size: st.size, mtimeMs: st.mtimeMs, isFile: st.isFile(), isDir: st.isDirectory() };
    } catch (err) {
      if (err instanceof FsGuardError && err.code !== "not-found") throw err;
      return null;
    }
  }

  /** Read a UTF-8 text file (bounded). */
  async readText(rel: string, maxBytes = MAX_DEFAULT): Promise<{ text: string; size: number; truncated: boolean; mtimeMs: number }> {
    const real = await this.resolve(rel);
    // O_RDONLY explicitly; O_NOFOLLOW is not needed after realpath but is harmless where supported.
    const flags = fsc.O_RDONLY | (process.platform !== "win32" && fsc.O_NOFOLLOW ? fsc.O_NOFOLLOW : 0);
    const handle = await fs.open(real, flags);
    try {
      const st = await handle.stat();
      if (!st.isFile()) throw new FsGuardError(`not a regular file: ${rel}`, "not-a-file");
      const toRead = Math.min(st.size, maxBytes);
      const buf = Buffer.alloc(toRead);
      let offset = 0;
      while (offset < toRead) {
        const { bytesRead } = await handle.read(buf, offset, toRead - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      return { text: buf.subarray(0, offset).toString("utf8"), size: st.size, truncated: st.size > maxBytes, mtimeMs: st.mtimeMs };
    } finally {
      await handle.close();
    }
  }

  async readJson<T = unknown>(rel: string, maxBytes = MAX_DEFAULT): Promise<T> {
    const { text } = await this.readText(rel, maxBytes);
    return parseLenientJson(text) as T;
  }

  /** List a directory's entries (names only). Symlinked entries are reported but never followed out of root. */
  async list(rel: string): Promise<Array<{ name: string; isDir: boolean; isFile: boolean; isSymlink: boolean }>> {
    let real: string;
    try {
      real = await this.resolve(rel);
    } catch (err) {
      if (err instanceof FsGuardError && err.code === "not-found") return [];
      throw err;
    }
    const entries = await fs.readdir(real, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDir: e.isDirectory(), isFile: e.isFile(), isSymlink: e.isSymbolicLink() }));
  }
}

export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Upstream documents that a hand-edited intents.json with a trailing comma,
 * comments or a BOM "still reads as every row". Match that leniency without
 * eval: strip BOM, comments outside strings, and trailing commas.
 */
export function parseLenientJson(text: string): unknown {
  const src = text.replace(/^﻿/, "");
  try {
    return JSON.parse(src);
  } catch {
    let out = "";
    let inStr = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        out += c;
        if (c === "\\") {
          out += src[++i] ?? "";
        } else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        out += c;
      } else if (c === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i++;
        out += "\n";
      } else if (c === "/" && src[i + 1] === "*") {
        i += 2;
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
        i++;
      } else out += c;
    }
    out = out.replace(/,(\s*[\]}])/g, "$1");
    return JSON.parse(out);
  }
}
