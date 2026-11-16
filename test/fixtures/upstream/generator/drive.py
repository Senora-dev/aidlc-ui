"""Drive the real installed AI-DLC engine with no model, the way upstream's own
tests/harness/scope-run.ts does: the agent stand-in runs engine commands and
fires the hooks Claude Code would fire; the person's words go only through the
real human-turn hook. Used only to generate genuine upstream records for
aidlc-ui's compatibility fixtures."""
import json, os, subprocess, sys

SID = os.environ.get("CLAUDE_CODE_SESSION_ID", "11111111-2222-3333-4444-555555555555")
PROJ = os.getcwd()
LOG = []


def run(args, stdin=None, check=False):
    p = subprocess.run(["aidlc", *args], input=stdin, capture_output=True, text=True, cwd=PROJ, timeout=180)
    out = p.stdout.strip()
    LOG.append((args, p.returncode, out[:300], p.stderr.strip()[:300]))
    if check and p.returncode != 0:
        raise SystemExit(f"FAILED {args}: {out}\n{p.stderr}")
    return p.returncode, out, p.stderr


def eng(*args):
    code, out, err = run(["engine", *args])
    try:
        return json.loads(out)
    except Exception:
        return {"_raw": out, "_err": err, "_code": code}


def hook(name, payload):
    payload = {"session_id": SID, "cwd": PROJ, **payload}
    return run(["engine", "hook", name], stdin=json.dumps(payload))


def session_start():
    return hook("session-start", {"hook_event_name": "SessionStart", "source": "startup"})


def say(text):
    return hook("record-human-turn", {"hook_event_name": "UserPromptSubmit", "prompt": text})


def write(rel, content):
    path = os.path.join(PROJ, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)
    return hook("write-audit-log", {
        "hook_event_name": "PostToolUse", "tool_name": "Write",
        "tool_input": {"file_path": path, "content": content},
        "tool_response": {"filePath": path, "success": True},
    })


def show(d, n=600):
    if isinstance(d, dict):
        keys = ["kind", "stage", "message", "error", "next", "command", "narration", "produces", "gate", "receipt"]
        print({k: (str(d[k])[:n]) for k in keys if k in d})
    else:
        print(str(d)[:n])


def task(agent, prompt, work):
    asked = {"subagent_type": agent, "description": "stage work", "prompt": prompt}
    code, out, err = hook("deliver-stage-rules", {"hook_event_name": "PreToolUse", "tool_name": "Task", "tool_input": asked})
    inp = asked
    try:
        upd = json.loads(out).get("hookSpecificOutput", {}).get("updatedInput")
        if isinstance(upd, dict):
            inp = {**asked, **upd}
    except Exception:
        pass
    hook("guard-tool-call", {"hook_event_name": "PreToolUse", "tool_name": "Task", "tool_input": inp})
    work()
    hook("log-subagent", {"hook_event_name": "SubagentStop", "agent_type": agent, "stop_hook_active": False})
    hook("deliver-stage-rules", {"hook_event_name": "PostToolUse", "tool_name": "Task", "tool_input": inp,
                                 "tool_response": {"content": [{"type": "text", "text": "done"}]}})


def review_text(reviewer, it=1, verdict="READY"):
    return (f"## Review\n\n**Verdict:** {verdict}\n**Reviewer:** {reviewer}\n**Date:** 2026-11-15T00:00:00Z\n**Iteration:** {it}\n\n"
            "### Findings\n\n**Prior findings**\n\n| ID | Now | Severity | Note |\n|---|---|---|---|\n\n**New findings**\n\n"
            "| Severity | Location | Finding | Required action |\n|---|---|---|---|\n\n### Summary\n\nReady.\n")


def review(stage, reviewer, it=1):
    import re as _re
    r = eng("log", "review", "--stage", stage, "--reviewer", reviewer, "--iteration", str(it))
    m = _re.search(r"Retry with --iteration (\d+)", r.get("_err", ""))
    if m:
        it = int(m.group(1))
        r = eng("log", "review", "--stage", stage, "--reviewer", reviewer, "--iteration", str(it))
    f = r.get("reviewFile")
    if not f:
        return r
    task(reviewer, f"Review {stage}", lambda: write(f, review_text(reviewer, it)))
    return eng("log", "review", "--stage", stage, "--reviewer", reviewer, "--iteration", str(it), "--verdict", "READY")
