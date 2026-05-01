#!/usr/bin/env python3
"""
Reconcile the cached `src/` directory tree with the current autoware.repos.

Cache hits can serve a rearranged or renamed repo set. After restore, anything
the cache holds that's no longer in autoware.repos must be removed; anything
whose URL has changed must be removed too so vcs import will re-clone it from
the new origin. Empty parent directories are pruned afterwards.

vcs import in --skip-existing mode handles missing entries; this script handles
the inverse — stale entries the cache shouldn't keep.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys

import yaml

REPOS_FILE = "autoware-meta/autoware/repositories/autoware.repos"
SRC_ROOT = "src"


def norm_url(url: str) -> str:
    """Normalize git URLs so https:// and git@ forms compare equal."""
    url = url.strip()
    m = re.match(r"^git@([^:]+):(.+?)(?:\.git)?$", url)
    if m:
        return f"https://{m.group(1)}/{m.group(2)}"
    if url.endswith(".git"):
        url = url[:-4]
    return url


def find_clone_paths(root: str) -> set[str]:
    """Return every directory under root whose immediate child is `.git`."""
    found: set[str] = set()
    if not os.path.isdir(root):
        return found
    for current, dirs, _files in os.walk(root):
        if ".git" in dirs:
            found.add(os.path.normpath(current))
            dirs.clear()  # never descend into a repo
    return found


def prune_empty_intermediates(src_root: str, clone_paths: set[str]) -> None:
    """Remove empty intermediate directories under src_root.

    Never descends into clone roots or .git directories — those legitimately
    contain empty subdirectories (refs/tags, branches, objects/info) that git
    creates and recreates lazily.
    """
    if not os.path.isdir(src_root):
        return

    intermediates: list[str] = []
    stack = [src_root]
    while stack:
        d = stack.pop()
        try:
            entries = os.listdir(d)
        except OSError:
            continue
        for entry in entries:
            full = os.path.join(d, entry)
            if not os.path.isdir(full):
                continue
            if entry == ".git":
                continue
            if os.path.normpath(full) in clone_paths:
                continue
            intermediates.append(full)
            stack.append(full)

    for path in sorted(intermediates, key=lambda p: -p.count(os.sep)):
        try:
            os.rmdir(path)
            print(f"reconcile: removed empty dir {path}")
        except OSError:
            pass  # not empty, leave it


def main() -> int:
    if not os.path.isfile(REPOS_FILE):
        print(f"reconcile: {REPOS_FILE} missing — meta sync must run first")
        return 1

    with open(REPOS_FILE) as f:
        data = yaml.safe_load(f)
    repos: dict[str, dict] = data.get("repositories") or {}

    expected_paths = {
        os.path.normpath(os.path.join(SRC_ROOT, key)) for key in repos
    }
    actual_paths = find_clone_paths(SRC_ROOT)

    # 1. Remove clones at paths no longer in autoware.repos.
    stale = actual_paths - expected_paths
    for path in sorted(stale):
        print(f"reconcile: removing stale clone {path}")
        shutil.rmtree(path)

    # 2. Remove clones whose origin URL no longer matches.
    for key, entry in repos.items():
        if not entry or "url" not in entry:
            continue
        path = os.path.join(SRC_ROOT, key)
        gitdir = os.path.join(path, ".git")
        if not os.path.isdir(gitdir):
            continue
        try:
            actual = subprocess.check_output(
                ["git", "-C", path, "remote", "get-url", "origin"],
                text=True,
            ).strip()
        except subprocess.CalledProcessError:
            print(f"reconcile: {path} has no origin remote, removing")
            shutil.rmtree(path)
            continue
        if norm_url(actual) != norm_url(entry["url"]):
            print(
                f"reconcile: {key} url changed "
                f"({norm_url(actual)} -> {norm_url(entry['url'])}), re-cloning",
            )
            shutil.rmtree(path)

    # 3. Prune empty intermediate dirs (e.g. src/old-category/ left behind after
    #    stage 1). Skips clone roots and their .git internals.
    surviving_clones = find_clone_paths(SRC_ROOT)
    prune_empty_intermediates(SRC_ROOT, surviving_clones)

    return 0


if __name__ == "__main__":
    sys.exit(main())
