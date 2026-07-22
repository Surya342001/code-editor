#!/usr/bin/env python3
import argparse
import json
import subprocess
import sys
from typing import Any, Dict, List, Optional


def emit(data: Dict[str, Any]) -> None:
    print(json.dumps(data, ensure_ascii=True))


def run_git(cwd: str, args: List[str], allow_error: bool = False) -> str:
    proc = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()

    if proc.returncode != 0 and not allow_error:
        msg = stderr or stdout or f"git {' '.join(args)} failed"
        raise RuntimeError(msg)
    return stdout


def safe_git(cwd: str, args: List[str], default: str = "") -> str:
    try:
        return run_git(cwd, args)
    except Exception:
        return default


def cmd_is_repo(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        run_git(cwd, ["rev-parse", "--git-dir"])
        return {"ok": True, "isRepo": True}
    except Exception:
        return {"ok": True, "isRepo": False}


def cmd_status(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    raw = safe_git(cwd, ["status", "--porcelain", "-u"], "")
    branch = safe_git(cwd, ["branch", "--show-current"], "HEAD")
    ahead = safe_git(cwd, ["rev-list", "--count", "@{u}..HEAD"], "0")
    behind = safe_git(cwd, ["rev-list", "--count", "HEAD..@{u}"], "0")

    files = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        files.append({"xy": line[:2], "path": line[3:].strip()})

    return {
        "ok": True,
        "branch": branch,
        "ahead": int(ahead or 0),
        "behind": int(behind or 0),
        "files": files,
    }


def cmd_diff(cwd: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    file_path = payload.get("filePath")
    if file_path:
        unified = safe_git(cwd, ["diff", "HEAD", "--", file_path], "")
        staged = safe_git(cwd, ["diff", "--cached", "--", file_path], "")
    else:
        unified = safe_git(cwd, ["diff", "HEAD"], "")
        staged = safe_git(cwd, ["diff", "--cached"], "")

    return {"ok": True, "diff": unified or staged or "(no diff)"}


def cmd_log(cwd: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    n = int(payload.get("n") or 15)
    out = run_git(cwd, ["log", "--oneline", "--decorate", f"-{n}"])
    return {"ok": True, "log": out}


def cmd_stage_all(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    run_git(cwd, ["add", "-A"])
    return {"ok": True}


def cmd_stage(cwd: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    run_git(cwd, ["add", payload["filePath"]])
    return {"ok": True}


def cmd_unstage(cwd: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    run_git(cwd, ["restore", "--staged", payload["filePath"]])
    return {"ok": True}


def cmd_commit(cwd: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    run_git(cwd, ["commit", "-m", payload["message"]])
    return {"ok": True}


def cmd_push(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    out = run_git(cwd, ["push"])
    return {"ok": True, "out": out}


def cmd_discard(cwd: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    file_path = payload["filePath"]
    try:
        run_git(cwd, ["restore", "--worktree", "--", file_path])
    except Exception:
        run_git(cwd, ["checkout", "--", file_path])
    return {"ok": True}


def cmd_init(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    run_git(cwd, ["init"])
    return {"ok": True}


def cmd_pull(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    out = run_git(cwd, ["pull"])
    return {"ok": True, "out": out}


def cmd_fetch(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    out = run_git(cwd, ["fetch", "--all", "--prune"])
    return {"ok": True, "out": out}


def cmd_branches(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    local_raw = safe_git(cwd, ["branch"], "")
    remote_raw = safe_git(cwd, ["branch", "-r"], "")

    branches = []
    for line in local_raw.splitlines():
        if not line.strip():
            continue
        branches.append({
            "name": line.replace("*", "", 1).strip(),
            "current": line.strip().startswith("*"),
        })

    remotes = [
        line.strip()
        for line in remote_raw.splitlines()
        if line.strip() and "HEAD ->" not in line
    ]

    return {"ok": True, "branches": branches, "remotes": remotes}


def cmd_create_branch(cwd: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    run_git(cwd, ["checkout", "-b", payload["name"]])
    return {"ok": True}


def cmd_switch_branch(cwd: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    run_git(cwd, ["checkout", payload["name"]])
    return {"ok": True}


def cmd_delete_branch(cwd: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    force = bool(payload.get("force"))
    run_git(cwd, ["branch", "-D" if force else "-d", payload["name"]])
    return {"ok": True}


def cmd_stash(cwd: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    msg = payload.get("message")
    args = ["stash", "push", "-u"]
    if msg:
        args += ["-m", msg]
    run_git(cwd, args)
    return {"ok": True}


def cmd_stash_pop(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    run_git(cwd, ["stash", "pop"])
    return {"ok": True}


def cmd_stash_drop(cwd: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    idx = int(payload["index"])
    run_git(cwd, ["stash", "drop", f"stash@{{{idx}}}"])
    return {"ok": True}


def cmd_stash_list(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    out = safe_git(cwd, ["stash", "list"], "")
    return {"ok": True, "stashes": [x for x in out.splitlines() if x.strip()]}


def cmd_remotes(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    out = safe_git(cwd, ["remote", "-v"], "")
    remotes: Dict[str, str] = {}
    for line in out.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 1)
        if len(parts) != 2:
            continue
        name, rest = parts
        if name in remotes:
            continue
        remotes[name] = rest.split(" ", 1)[0]

    return {
        "ok": True,
        "remotes": [{"name": name, "url": url} for name, url in remotes.items()],
    }


def cmd_add_remote(cwd: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    run_git(cwd, ["remote", "add", payload["name"], payload["url"]])
    return {"ok": True}


def current_branch(cwd: str) -> str:
    branch = run_git(cwd, ["branch", "--show-current"])
    if not branch:
        raise RuntimeError("Detached HEAD is not supported for this action")
    return branch


def cmd_publish_branch(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    branch = current_branch(cwd)
    out = run_git(cwd, ["push", "-u", "origin", branch])
    return {"ok": True, "out": out, "branch": branch}


def cmd_pull_rebase(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    out = run_git(cwd, ["pull", "--rebase"])
    return {"ok": True, "out": out}


def cmd_rebase_main(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    current = current_branch(cwd)
    run_git(cwd, ["fetch", "origin", "main", "--prune"])
    out = run_git(cwd, ["rebase", "origin/main"])
    return {"ok": True, "out": out, "branch": current}


def cmd_abort_rebase(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    out = run_git(cwd, ["rebase", "--abort"])
    return {"ok": True, "out": out}


def to_https_repo_url(raw: str) -> str:
    if raw.startswith("git@"):
        # git@github.com:owner/repo.git -> https://github.com/owner/repo
        host_path = raw.split("@", 1)[1]
        host, repo_path = host_path.split(":", 1)
        repo_path = repo_path[:-4] if repo_path.endswith(".git") else repo_path
        return f"https://{host}/{repo_path}"

    if raw.startswith("http://") or raw.startswith("https://"):
        cleaned = raw[:-4] if raw.endswith(".git") else raw
        return cleaned

    raise RuntimeError("Unsupported remote URL format")


def cmd_pr_url(cwd: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    branch = payload.get("branch") or current_branch(cwd)
    remote_name = payload.get("remote") or "origin"
    remote_url = run_git(cwd, ["remote", "get-url", remote_name])
    base_url = to_https_repo_url(remote_url)
    pr_url = f"{base_url}/compare/{branch}?expand=1"
    return {"ok": True, "url": pr_url, "branch": branch}


def has_local_branch(cwd: str, branch_name: str) -> bool:
    proc = subprocess.run(
        ["git", "show-ref", "--verify", "--quiet", f"refs/heads/{branch_name}"],
        cwd=cwd,
    )
    return proc.returncode == 0


def cmd_sync_main(cwd: str, _payload: Dict[str, Any]) -> Dict[str, Any]:
    current = run_git(cwd, ["branch", "--show-current"])
    logs: List[str] = []

    logs.append(run_git(cwd, ["fetch", "origin", "main", "--prune"]))

    if not has_local_branch(cwd, "main"):
        run_git(cwd, ["checkout", "-b", "main", "origin/main"])
        logs.append("Created local main from origin/main")
    else:
        run_git(cwd, ["checkout", "main"])

    logs.append(run_git(cwd, ["pull", "--ff-only", "origin", "main"]))

    if current and current != "main":
        run_git(cwd, ["checkout", current])
        logs.append(run_git(cwd, ["merge", "main"]))

    return {"ok": True, "out": "\n".join([x for x in logs if x])}


HANDLERS = {
    "is_repo": cmd_is_repo,
    "status": cmd_status,
    "diff": cmd_diff,
    "log": cmd_log,
    "stage_all": cmd_stage_all,
    "stage": cmd_stage,
    "unstage": cmd_unstage,
    "commit": cmd_commit,
    "push": cmd_push,
    "discard": cmd_discard,
    "init": cmd_init,
    "pull": cmd_pull,
    "fetch": cmd_fetch,
    "branches": cmd_branches,
    "create_branch": cmd_create_branch,
    "switch_branch": cmd_switch_branch,
    "delete_branch": cmd_delete_branch,
    "stash": cmd_stash,
    "stash_pop": cmd_stash_pop,
    "stash_drop": cmd_stash_drop,
    "stash_list": cmd_stash_list,
    "remotes": cmd_remotes,
    "add_remote": cmd_add_remote,
    "sync_main": cmd_sync_main,
    "publish_branch": cmd_publish_branch,
    "pull_rebase": cmd_pull_rebase,
    "rebase_main": cmd_rebase_main,
    "abort_rebase": cmd_abort_rebase,
    "pr_url": cmd_pr_url,
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Git bridge for Electron")
    parser.add_argument("command")
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--payload", default="{}")
    args = parser.parse_args()

    try:
        payload = json.loads(args.payload or "{}")
        if not isinstance(payload, dict):
            payload = {}
    except Exception:
        payload = {}

    handler = HANDLERS.get(args.command)
    if not handler:
        emit({"ok": False, "error": f"Unknown command: {args.command}"})
        sys.exit(1)

    try:
        result = handler(args.cwd, payload)
        if "ok" not in result:
            result["ok"] = True
        emit(result)
    except Exception as exc:
        emit({"ok": False, "error": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main()
