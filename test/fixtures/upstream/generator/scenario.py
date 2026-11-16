import json, os, re, sys
sys.path.insert(0, os.environ["S"])
from drive import *

VERBOSE = os.environ.get("V") == "1"


def body_for(path, stage):
    name = os.path.basename(path)
    title = name.rsplit(".", 1)[0].replace("-", " ").title()
    if name.endswith(".json"):
        return json.dumps({"schema": "aidlc-traceability/1", "elements": [], "links": []}, indent=2) + "\n"
    if name.endswith("-questions.md"):
        return (f"# {title}\n\n## Question 1\nWhich behaviour matters most for {stage}?\n\n"
                "A) Correctness first\nB) Speed first\nX) Other\n\n[Answer]: A\n")
    return (f"# {title}\n\n> Stage: `{stage}`\n\n## Summary\n\nThis document was produced during **{stage}** "
            f"for the request. It records the agreed outcome.\n\n## Details\n\n- Point one\n- Point two\n\n"
            "| Item | Decision |\n| --- | --- |\n| Timeout | 30s, streamed |\n\n```ts\nexport const TIMEOUT_MS = 30_000;\n```\n")


def ask(stage, question, options, reply, details):
    r = eng("log", "decision", "--stage", stage, "--decision", question, "--options", options)
    say(reply)
    a = eng("log", "answer", "--stage", stage, "--details", details)
    if VERBOSE:
        print("  ask", r, a)


def run_stage(d, plan):
    """Do a run-stage directive's work, then report/gate per plan."""
    stage = d["stage"]
    for p in d.get("produces", []):
        if p.endswith("-questions.md"):
            write(p, body_for(p, stage))
    for q in plan.get("questions", {}).get(stage, []):
        ask(stage, *q)
    for p in d.get("produces", []):
        if not p.endswith("-questions.md"):
            write(p, body_for(p, stage))
    if not d.get("gate"):
        return eng("orchestrate", "report", "--stage", stage, "--result", "completed")
    if d.get("reviewer"):
        rv = review(stage, d["reviewer"], plan.setdefault("_it", {}).get(stage, 0) + 1)
        plan["_it"][stage] = plan["_it"].get(stage, 0) + 1
        if VERBOSE:
            print("REVIEW->", json.dumps(rv)[:400])
    r = eng("orchestrate", "report", "--stage", stage, "--result", "awaiting-approval")
    if VERBOSE:
        print("AWAIT->", json.dumps(r)[:3000])
    if stage == plan.get("stop_at_gate"):
        return {"kind": "_stop", "stage": stage}
    if stage in plan.get("reject", []) and not plan.setdefault("_rejected", set()).__contains__(stage):
        plan["_rejected"].add(stage)
        say("Request Changes: please also cover the retry behaviour")
        r = eng("orchestrate", "report", "--stage", stage, "--result", "rejected", "--user-input", "Request Changes")
        if VERBOSE:
            show(r)
        for p in d.get("produces", []):
            if p.endswith(".md") and not p.endswith("-questions.md"):
                write(p, body_for(p, stage) + "\n## Retry behaviour\n\nRetries use exponential backoff.\n")
        if d.get("reviewer"):
            plan["_it"][stage] += 1
            rv = review(stage, d["reviewer"], plan["_it"][stage])
            if VERBOSE:
                print("REVIEW2->", json.dumps(rv)[:400])
        r = eng("orchestrate", "report", "--stage", stage, "--result", "revised")
        if VERBOSE:
            print("REVISED->", json.dumps(r)[:3000])
    say("Approve")
    r = eng("orchestrate", "report", "--stage", stage, "--result", "approved", "--user-input", "Approve")
    m = re.search(r"Run `aidlc (engine state practices-promote[^`]*)`", r.get("message", ""))
    if m:
        import shlex
        print("  promote:", eng(*shlex.split(m.group(1))[1:]))
        r = eng("orchestrate", "report", "--stage", stage, "--result", "approved", "--user-input", "Approve")
    return r


def loop(plan, max_steps=60):
    d = eng("orchestrate", "next")
    for _ in range(max_steps):
        k = d.get("kind")
        if VERBOSE:
            show(d)
        if k == "load-steering":
            d = eng("orchestrate", "continue", d["receipt"])
        elif k == "run-stage":
            if d["stage"] == plan.get("stop_in_progress"):
                return d
            d = run_stage(d, plan)
            if d.get("kind") == "_stop":
                return d
            if d.get("kind") in (None,) or "error" in d:
                d = eng("orchestrate", "next")
        elif k == "done":
            nd = eng("orchestrate", "next")
            if nd.get("kind") == "done":
                return nd
            d = nd
        elif k in ("print",) and "next" in str(d.get("message", "")).lower():
            d = eng("orchestrate", "next")
        else:
            return d
    return d


def new_intent(scope, text, label):
    say(f"/aidlc {scope} {text}")
    d = eng("orchestrate", "next", scope, text)
    if d.get("ask_type") == "new-work-routing":
        say("2")
        cmd = d["new_intent_command"].split()[1:]
        d = eng(*cmd[1:])
        if VERBOSE:
            show(d)
    m = re.search(r"`aidlc (engine intent create [^`]*)`", d.get("message", ""))
    if not m:
        print("no create:", d)
        return None
    import shlex
    words = shlex.split(m.group(1))
    words = [label if w.startswith("<2-3 word") else w for w in words]
    code, out, err = run(words)
    print(out.splitlines()[0] if out else err)
    return out
