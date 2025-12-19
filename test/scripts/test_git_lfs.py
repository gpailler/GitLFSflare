#!/usr/bin/env python3
"""
End-to-end Git LFS test using actual git client with local repositories.

Creates local git repos, configures git-lfs to use the LFS server,
pushes a large file, then clones locally to verify download works.

Usage:
    python test_git_lfs.py --url "https://your-worker.workers.dev" --token "ghp_xxx" --org "your-org" --repo "your-repo"

Requirements:
    - git and git-lfs installed
    - GitHub token with repo access (for LFS authentication)
"""

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

# Colors
RED, GREEN, YELLOW, BLUE, RESET = "\033[31m", "\033[32m", "\033[33m", "\033[34m", "\033[0m"


def parse_args():
    parser = argparse.ArgumentParser(description="E2E Git LFS test using git client")
    parser.add_argument("--url", required=True, help="LFS server URL (e.g., https://your-worker.workers.dev)")
    parser.add_argument("--token", required=True, help="GitHub PAT with repo access")
    parser.add_argument("--org", required=True, help="GitHub org/user (for LFS path)")
    parser.add_argument("--repo", required=True, help="Repo name (for LFS path)")
    parser.add_argument("--keep", action="store_true", help="Keep temp directories after test")
    return parser.parse_args()


def run(cmd, cwd=None, env=None, capture=False):
    """Run a command and return output."""
    result = subprocess.run(
        cmd, cwd=cwd, env=env, shell=isinstance(cmd, str),
        capture_output=capture, text=True
    )
    if result.returncode != 0:
        if capture:
            print(f"{RED}Command failed: {cmd}{RESET}")
            print(f"{RED}stdout: {result.stdout}{RESET}")
            print(f"{RED}stderr: {result.stderr}{RESET}")
        raise subprocess.CalledProcessError(result.returncode, cmd)
    return result.stdout if capture else None


def info(msg):
    print(f"{BLUE}[*] {msg}{RESET}")


def success(msg):
    print(f"{GREEN}[✓] {msg}{RESET}")


def error(msg):
    print(f"{RED}[✗] {msg}{RESET}")


def check_prerequisites():
    """Verify git and git-lfs are installed."""
    try:
        run("git --version", capture=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        error("git is not installed")
        sys.exit(1)

    try:
        run("git lfs version", capture=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        error("git-lfs is not installed")
        sys.exit(1)


def main():
    args = parse_args()

    print(f"{BLUE}{'='*40}{RESET}")
    print(f"{BLUE}Git LFS End-to-End Test (Local Repos){RESET}")
    print(f"{BLUE}{'='*40}{RESET}\n")
    print(f"LFS Server: {args.url}")
    print(f"LFS Path:   {args.org}/{args.repo}\n")

    check_prerequisites()

    # Create temp directories
    base_dir = tempfile.mkdtemp(prefix="gitlfs_test_")
    bare_dir = os.path.join(base_dir, "remote.git")
    push_dir = os.path.join(base_dir, "push_repo")
    clone_dir = os.path.join(base_dir, "clone_repo")

    # Build LFS URL
    lfs_url = f"{args.url}/{args.org}/{args.repo}.git/info/lfs"
    lfs_host = args.url.replace("https://", "").replace("http://", "")

    # Environment
    env = os.environ.copy()
    env["GIT_LFS_SKIP_SMUDGE"] = "1"

    try:
        # Step 1: Create bare repo (acts as remote)
        info("Creating local bare repository (remote)...")
        run(f"git init --bare {bare_dir}", capture=True)
        success("Bare repository created")

        # Step 2: Create working repo
        info("Creating working repository...")
        run(f"git init {push_dir}", capture=True)
        run("git config user.email 'test@example.com'", cwd=push_dir)
        run("git config user.name 'Test User'", cwd=push_dir)
        run("git config commit.gpgsign false", cwd=push_dir)
        run(f"git remote add origin {bare_dir}", cwd=push_dir)
        success("Working repository created")

        # Step 3: Configure git-lfs
        info("Configuring git-lfs...")
        run("git lfs install --local", cwd=push_dir, capture=True)
        run(f"git config lfs.url {lfs_url}", cwd=push_dir)
        run(f"git config lfs.{lfs_url}.access basic", cwd=push_dir)

        # Store credentials for LFS (full path for useHttpPath)
        run("git config credential.useHttpPath true", cwd=push_dir)
        cred_file = os.path.join(push_dir, ".git-credentials")
        # Store credential with full LFS path
        lfs_cred_url = f"https://user:{args.token}@{lfs_host}/{args.org}/{args.repo}.git/info/lfs"
        with open(cred_file, "w") as f:
            f.write(f"{lfs_cred_url}\n")
        run(f"git config credential.helper 'store --file={cred_file}'", cwd=push_dir)

        success(f"git-lfs configured with URL: {lfs_url}")

        # Step 4: Create test files (various sizes)
        info("Creating test files...")
        original_hashes = {}

        # Create files with unique content
        unique_files = [
            ("file_1mb_a.bin", 1 * 1024 * 1024),
            ("file_1mb_b.bin", 1 * 1024 * 1024),  # Same size, different content
            ("file_512kb.bin", 512 * 1024),
            ("file_2mb.bin", 2 * 1024 * 1024),
            ("file_small.bin", 64 * 1024),  # 64KB
        ]

        for filename, size in unique_files:
            filepath = os.path.join(push_dir, filename)
            data = os.urandom(size)
            original_hashes[filename] = hashlib.sha256(data).hexdigest()
            with open(filepath, "wb") as f:
                f.write(data)
            success(f"  {filename}: {size // 1024}KB, hash: {original_hashes[filename][:12]}...")

        # Create duplicate content file (same content as file_small.bin -> same OID)
        dup_filename = "file_duplicate.bin"
        dup_source = "file_small.bin"
        shutil.copy(
            os.path.join(push_dir, dup_source),
            os.path.join(push_dir, dup_filename)
        )
        original_hashes[dup_filename] = original_hashes[dup_source]
        success(f"  {dup_filename}: 64KB, hash: {original_hashes[dup_filename][:12]}... (same as {dup_source})")

        test_files = unique_files + [(dup_filename, 64 * 1024)]

        # Step 5: Track with git-lfs
        info("Tracking files with git-lfs...")
        run("git lfs track '*.bin'", cwd=push_dir, capture=True)
        run("git add .gitattributes *.bin", cwd=push_dir, capture=True)
        success(f"{len(test_files)} files tracked")

        # Step 6: Commit
        info("Committing changes...")
        run("git commit -m 'Add LFS test files'", cwd=push_dir, capture=True)
        success("Changes committed")

        # Step 7: Push (this uploads to our LFS server)
        info("Pushing to remote (uploading to LFS server)...")
        push_env = env.copy()
        del push_env["GIT_LFS_SKIP_SMUDGE"]
        # Get current branch name (main or master depending on git version)
        branch = run("git branch --show-current", cwd=push_dir, capture=True).strip()
        run(f"git push -u origin {branch}", cwd=push_dir, env=push_env, capture=True)
        success("Push successful - file uploaded to LFS server")

        # Step 8: Clone from bare repo to test download
        info("Cloning from local remote to test download...")
        clone_env = env.copy()
        run(f"git clone {bare_dir} {clone_dir}", env=clone_env, capture=True)

        # Configure LFS for clone
        run("git lfs install --local", cwd=clone_dir, capture=True)
        run(f"git config lfs.url {lfs_url}", cwd=clone_dir)
        run(f"git config lfs.{lfs_url}.access basic", cwd=clone_dir)
        run("git config credential.useHttpPath true", cwd=clone_dir)
        clone_cred_file = os.path.join(clone_dir, ".git-credentials")
        with open(clone_cred_file, "w") as f:
            f.write(f"{lfs_cred_url}\n")
        run(f"git config credential.helper 'store --file={clone_cred_file}'", cwd=clone_dir)
        success("Clone ready")

        # Step 9: Pull LFS files
        info("Pulling LFS files (downloading from LFS server)...")
        pull_env = clone_env.copy()
        del pull_env["GIT_LFS_SKIP_SMUDGE"]
        run("git lfs pull", cwd=clone_dir, env=pull_env, capture=True)
        success("LFS pull successful")

        # Step 10: Verify downloaded files
        info("Verifying downloaded files...")
        for filename, expected_size in test_files:
            downloaded_file = os.path.join(clone_dir, filename)

            if not os.path.exists(downloaded_file):
                error(f"  {filename}: NOT FOUND")
                sys.exit(1)

            with open(downloaded_file, "rb") as f:
                downloaded_data = f.read()

            downloaded_hash = hashlib.sha256(downloaded_data).hexdigest()
            expected_hash = original_hashes[filename]

            if expected_hash != downloaded_hash:
                error(f"  {filename}: HASH MISMATCH")
                error(f"    Expected: {expected_hash}")
                error(f"    Got:      {downloaded_hash}")
                sys.exit(1)

            if len(downloaded_data) != expected_size:
                error(f"  {filename}: SIZE MISMATCH")
                error(f"    Expected: {expected_size}")
                error(f"    Got:      {len(downloaded_data)}")
                sys.exit(1)

            success(f"  {filename}: OK ({len(downloaded_data) // 1024}KB)")

        total_size = sum(size for _, size in test_files)
        print(f"\n{BLUE}{'='*40}{RESET}")
        print(f"{GREEN}All tests passed!{RESET}")
        print(f"{BLUE}{'='*40}{RESET}")
        print(f"Successfully uploaded and downloaded {len(test_files)} files ({total_size // 1024}KB total) via git-lfs")

    except subprocess.CalledProcessError as e:
        error(f"Command failed with exit code {e.returncode}")
        sys.exit(1)

    finally:
        if args.keep:
            print(f"\n{YELLOW}Temp directories kept at: {base_dir}{RESET}")
        else:
            shutil.rmtree(base_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
