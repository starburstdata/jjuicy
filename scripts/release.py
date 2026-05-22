#!/usr/bin/env python3
"""Release automation for jjuicy.

Two subcommands:
  generate  -- collect commits and print version + raw commits as JSON
               (the caller — typically the release skill — drafts the changelog)
  execute   -- apply version bump, commit, tag, push, GH release, homebrew PR
"""

import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
CARGO_TOML = REPO_ROOT / "Cargo.toml"
PACKAGE_JSON = REPO_ROOT / "package.json"
TAURI_TOML = REPO_ROOT / "Tauri.toml"
CHANGELOG_MD = REPO_ROOT / "CHANGELOG.md"

GITHUB_REPO = "starburstdata/jjuicy"
HOMEBREW_REPO = "starburstdata/homebrew-jjuicy"
HOMEBREW_FORMULA = "Formula/jjuicy.rb"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def run(cmd, cwd=None, check=True):
    result = subprocess.run(
        cmd, shell=True, capture_output=True, text=True, cwd=cwd
    )
    if check and result.returncode != 0:
        print(f"command failed: {cmd}", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)
    return result.stdout.strip()


def get_current_version():
    text = CARGO_TOML.read_text()
    m = re.search(r'^version = "([^"]+)"', text, re.MULTILINE)
    if not m:
        print("version not found in Cargo.toml", file=sys.stderr)
        sys.exit(1)
    return m.group(1)


def bump_version(current, bump_type):
    parts = current.split(".")
    if len(parts) != 3:
        print(f"unexpected version format: {current}", file=sys.stderr)
        sys.exit(1)
    major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2])
    if bump_type == "major":
        return f"{major + 1}.0.0"
    elif bump_type == "minor":
        return f"{major}.{minor + 1}.0"
    else:
        return f"{major}.{minor}.{patch + 1}"


_COMMIT_SEP = "<<<COMMIT_SEP>>>"


def get_commits_since_tag(version):
    """Return raw commit descriptions since the given version tag."""
    out = run(
        f'jj log -r "v{version}..@" --no-graph '
        f'--template \'description ++ "\\n{_COMMIT_SEP}\\n"\''
    )
    return [c.strip() for c in out.split(_COMMIT_SEP) if c.strip()]


# ---------------------------------------------------------------------------
# generate subcommand
# ---------------------------------------------------------------------------

def cmd_generate(args):
    current = get_current_version()
    new_version = args.version if args.version else bump_version(current, args.bump)

    print(f"current version : {current}", file=sys.stderr)
    print(f"new version     : {new_version}", file=sys.stderr)
    print("collecting commits...", file=sys.stderr)

    commits = get_commits_since_tag(current)
    if not commits:
        print("no commits since last release", file=sys.stderr)
        sys.exit(0)

    print(f"found {len(commits)} commit(s)", file=sys.stderr)

    result = {
        "version": new_version,
        "commits": commits,
    }
    print(json.dumps(result, indent=2))


# ---------------------------------------------------------------------------
# execute subcommand
# ---------------------------------------------------------------------------

def update_version_files(new_version):
    # Cargo.toml: first version= line only (the [package] entry)
    text = CARGO_TOML.read_text()
    text = re.sub(
        r'^(version = ")[^"]+(")',
        f'\\g<1>{new_version}\\2',
        text, count=1, flags=re.MULTILINE
    )
    CARGO_TOML.write_text(text)

    # package.json
    text = PACKAGE_JSON.read_text()
    text = re.sub(r'"version": "[^"]+"', f'"version": "{new_version}"', text, count=1)
    PACKAGE_JSON.write_text(text)

    # Tauri.toml
    text = TAURI_TOML.read_text()
    text = re.sub(
        r'^(version = ")[^"]+(")',
        f'\\g<1>{new_version}\\2',
        text, count=1, flags=re.MULTILINE
    )
    TAURI_TOML.write_text(text)


def update_changelog(new_version, entry):
    current = CHANGELOG_MD.read_text()
    header = f"## [{new_version}](releases/tag/v{new_version})"
    new_section = f"{header}\n\n{entry}"

    # Inject after the first "# " heading
    m = re.search(r'^# .+\n', current, re.MULTILINE)
    if m:
        insert_at = m.end()
        updated = current[:insert_at] + "\n" + new_section + "\n\n" + current[insert_at:].lstrip()
    else:
        updated = new_section + "\n\n" + current
    CHANGELOG_MD.write_text(updated)


def fetch_tarball_sha256(version, retries=12, delay=5):
    url = f"https://github.com/{GITHUB_REPO}/archive/refs/tags/v{version}.tar.gz"
    print(f"waiting for tarball at {url} ...", file=sys.stderr)
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "release-script"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                sha = hashlib.sha256()
                while chunk := resp.read(65536):
                    sha.update(chunk)
                return sha.hexdigest()
        except urllib.error.HTTPError as e:
            if e.code == 404 and attempt < retries - 1:
                print(f"  not ready yet, retrying in {delay}s ({attempt + 1}/{retries})", file=sys.stderr)
                time.sleep(delay)
            else:
                raise
    print("timed out waiting for tarball", file=sys.stderr)
    sys.exit(1)


def create_github_release(version, notes_file):
    return run(
        f"gh release create v{version} "
        f"--title 'v{version}' "
        f"--notes-file {notes_file} "
        f"--repo {GITHUB_REPO}"
    )


def open_homebrew_pr(version, sha256, tmpdir):
    tarball_url = (
        f"https://github.com/{GITHUB_REPO}/archive/refs/tags/v{version}.tar.gz"
    )
    clone_dir = str(tmpdir / "homebrew-jjuicy")

    run(f"gh repo clone {HOMEBREW_REPO} {clone_dir}")
    formula_path = Path(clone_dir) / HOMEBREW_FORMULA
    formula = formula_path.read_text()

    formula = re.sub(r'^(\s*url ")[^"]+"', f'\\g<1>{tarball_url}"', formula, flags=re.MULTILINE)
    formula = re.sub(r'^(\s*sha256 ")[^"]+"', f'\\g<1>{sha256}"', formula, flags=re.MULTILINE)
    formula_path.write_text(formula)

    branch = f"bump-v{version}"
    run(f"git -C {clone_dir} checkout -b {branch}")
    run(f"git -C {clone_dir} add {HOMEBREW_FORMULA}")
    run(f"git -C {clone_dir} commit -m 'jjuicy {version}'")
    run(f"git -C {clone_dir} push origin {branch}")
    pr_url = run(
        f"gh pr create "
        f"--repo {HOMEBREW_REPO} "
        f"--title 'jjuicy {version}' "
        f"--body 'Bumps jjuicy to {version}.' "
        f"--head {branch}"
    )
    return pr_url


def cmd_execute(args):
    import tempfile

    version = args.version
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        print(f"invalid version: {version}", file=sys.stderr)
        sys.exit(1)

    changelog_text = Path(args.changelog_file).read_text().strip()

    print(f"\n=== releasing v{version} ===\n")

    print("updating version files...")
    update_version_files(version)

    print("running cargo update...")
    run("cargo update", cwd=REPO_ROOT)

    print("running npm update...")
    run("npm update", cwd=REPO_ROOT)

    print("updating CHANGELOG.md...")
    update_changelog(version, changelog_text)

    print("committing...")
    run(f'jj commit -m "Bump version to {version}"')

    print("creating tag...")
    run(f"jj tag create v{version} -r @-")

    print("pushing to GitHub...")
    run("jj git push --remote origin --all")
    # push tag explicitly — jj --all may not include tags
    run(f"git push origin v{version}", cwd=REPO_ROOT)

    print("creating GitHub release...")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
        f.write(changelog_text)
        notes_file = f.name
    try:
        release_url = create_github_release(version, notes_file)
    finally:
        Path(notes_file).unlink(missing_ok=True)

    print("fetching tarball SHA256...")
    sha256 = fetch_tarball_sha256(version)
    print(f"sha256: {sha256}")

    print("opening homebrew PR...")
    with tempfile.TemporaryDirectory() as tmpdir_str:
        pr_url = open_homebrew_pr(version, sha256, Path(tmpdir_str))

    print(f"\nrelease v{version} complete.")
    print(f"release:     {release_url}")
    print(f"homebrew PR: {pr_url}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="jjuicy release tool")
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate", help="generate changelog proposal")
    group = gen.add_mutually_exclusive_group()
    group.add_argument("--bump", choices=["patch", "minor", "major"], default="patch",
                       help="version bump type (default: patch)")
    group.add_argument("--version", help="explicit target version")

    exe = sub.add_parser("execute", help="apply version bump, commit, release")
    exe.add_argument("--version", required=True, help="version to release")
    exe.add_argument("--changelog-file", required=True,
                     help="path to file containing the changelog entry (markdown)")

    args = parser.parse_args()
    if args.command == "generate":
        cmd_generate(args)
    elif args.command == "execute":
        cmd_execute(args)


if __name__ == "__main__":
    main()
