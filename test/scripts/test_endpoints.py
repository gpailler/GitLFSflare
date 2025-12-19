#!/usr/bin/env python3
"""
Test Git LFS server endpoints against a deployed instance.

Usage:
    python test_endpoints.py --url "https://your-worker.workers.dev"

    # With authentication for full test coverage
    python test_endpoints.py --url "..." --token "ghp_xxx" --org "your-org" --repo "your-repo"
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error

# Colors
RED, GREEN, YELLOW, BLUE, RESET = "\033[31m", "\033[32m", "\033[33m", "\033[34m", "\033[0m"

VALID_OID = "a" * 64
results = {"passed": 0, "failed": 0, "skipped": 0}


def parse_args():
    parser = argparse.ArgumentParser(description="Test Git LFS endpoints")
    parser.add_argument("--url", default=os.environ.get("LFS_SERVER_URL"), help="LFS server URL")
    parser.add_argument("--token", default=os.environ.get("GITHUB_TOKEN"), help="GitHub PAT")
    parser.add_argument("--org", default=os.environ.get("TEST_ORG", "test-org"), help="Test org")
    parser.add_argument("--repo", default=os.environ.get("TEST_REPO", "test-repo"), help="Test repo")
    args = parser.parse_args()
    if not args.url:
        parser.error("--url or LFS_SERVER_URL is required")
    return args


def lfs_batch(base_url, org, repo, request_body, token=None):
    url = f"{base_url}/{org}/{repo}.git/info/lfs/objects/batch"
    headers = {"Content-Type": "application/vnd.git-lfs+json", "Accept": "application/vnd.git-lfs+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, json.dumps(request_body).encode(), headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def test_pass(msg):
    print(f"  {GREEN}PASS{RESET} {msg}")
    results["passed"] += 1


def test_fail(msg, expected, got):
    print(f"  {RED}FAIL{RESET} {msg}")
    print(f"       Expected: {expected}")
    print(f"       Got: {got}")
    results["failed"] += 1


def skip(msg, reason):
    print(f"  {YELLOW}SKIP{RESET} {msg} - {reason}")
    results["skipped"] += 1


def section(title):
    print(f"\n{BLUE}[{title}]{RESET}")


def test_health(base_url):
    section("Health Endpoint")
    req = urllib.request.Request(f"{base_url}/health")
    with urllib.request.urlopen(req) as resp:
        status, body = resp.status, resp.read().decode()
    test_pass("GET /health returns 200") if status == 200 else test_fail("GET /health returns 200", "200", status)
    test_pass('Response contains status:"ok"') if '"status":"ok"' in body else test_fail('Response contains status:"ok"', '{"status":"ok"}', body)


def test_no_auth(base_url, org, repo):
    section("No Authentication")
    status, _ = lfs_batch(base_url, org, repo, {"operation": "download", "objects": [{"oid": VALID_OID, "size": 100}]})
    test_pass("Batch without auth returns 401") if status == 401 else test_fail("Batch without auth returns 401", "401", status)


def test_invalid_token(base_url, org, repo):
    section("Invalid Token Format")
    status, _ = lfs_batch(base_url, org, repo, {"operation": "download", "objects": [{"oid": VALID_OID, "size": 100}]}, "invalid_token")
    test_pass("Invalid token returns 401") if status == 401 else test_fail("Invalid token returns 401", "401", status)


def test_invalid_org(base_url, token):
    section("Invalid Organization")
    if not token:
        return skip("Invalid org test", "token not set")
    status, _ = lfs_batch(base_url, "not-allowed-org", "repo", {"operation": "download", "objects": [{"oid": VALID_OID, "size": 100}]}, token)
    test_pass("Disallowed org returns 403") if status == 403 else test_fail("Disallowed org returns 403", "403", status)


def test_invalid_batch(base_url, org, repo, token):
    section("Invalid Batch Request")
    if not token:
        return skip("Invalid batch test", "token not set")

    status, _ = lfs_batch(base_url, org, repo, {"operation": "invalid", "objects": [{"oid": VALID_OID, "size": 100}]}, token)
    test_pass("Invalid operation returns 422") if status == 422 else test_fail("Invalid operation returns 422", "422", status)

    status, _ = lfs_batch(base_url, org, repo, {"operation": "download", "objects": [{"oid": "bad", "size": 100}]}, token)
    test_pass("Invalid OID returns 422") if status == 422 else test_fail("Invalid OID returns 422", "422", status)

    status, _ = lfs_batch(base_url, org, repo, {"operation": "download", "objects": []}, token)
    test_pass("Empty objects returns 422") if status == 422 else test_fail("Empty objects returns 422", "422", status)

    status, _ = lfs_batch(base_url, org, repo, {"operation": "download", "hash_algo": "sha512", "objects": [{"oid": VALID_OID, "size": 100}]}, token)
    test_pass("Unsupported hash_algo returns 409") if status == 409 else test_fail("Unsupported hash_algo returns 409", "409", status)


def test_download_success(base_url, org, repo, token):
    section("Download - Returns Pre-signed URL")
    if not token:
        return skip("Download test", "token not set")
    status, resp = lfs_batch(base_url, org, repo, {"operation": "download", "objects": [{"oid": VALID_OID, "size": 100}]}, token)
    test_pass("Download batch returns 200") if status == 200 else test_fail("Download batch returns 200", "200", status)
    test_pass("Response includes transfer:basic") if resp.get("transfer") == "basic" else test_fail("Response includes transfer:basic", "basic", resp.get("transfer"))
    obj = resp.get("objects", [{}])[0]
    # Server returns pre-signed URLs without checking object existence (optimization)
    # Clients handle 404s directly from R2
    has_download = obj.get("actions", {}).get("download", {}).get("href")
    test_pass("Object has download URL") if has_download else test_fail("Object has download URL", "download action with href", obj)


def test_invalid_repo_name(base_url, org, token):
    section("Invalid Repository Name")
    if not token:
        return skip("Invalid repo name test", "token not set")
    # Use .hidden (starts with period) - ../traversal gets URL-normalized before reaching validation
    status, _ = lfs_batch(base_url, org, ".hidden", {"operation": "download", "objects": [{"oid": VALID_OID, "size": 100}]}, token)
    test_pass("Invalid repo name returns 400") if status == 400 else test_fail("Invalid repo name returns 400", "400", status)


def test_batch_size_limit(base_url, org, repo, token):
    section("Batch Size Limit")
    if not token:
        return skip("Batch size limit test", "token not set")
    objects = [{"oid": f"{i:04x}".ljust(64, "a"), "size": 100} for i in range(101)]
    status, _ = lfs_batch(base_url, org, repo, {"operation": "download", "objects": objects}, token)
    test_pass("101 objects returns 413") if status == 413 else test_fail("101 objects returns 413", "413", status)


def main():
    args = parse_args()
    print(f"{BLUE}{'='*32}{RESET}")
    print(f"{BLUE}Git LFS Server Endpoint Tests{RESET}")
    print(f"{BLUE}{'='*32}{RESET}\n")
    print(f"Server URL: {args.url}")
    print(f"Test Org: {args.org}")
    print(f"Test Repo: {args.repo}")

    test_health(args.url)
    test_no_auth(args.url, args.org, args.repo)
    test_invalid_token(args.url, args.org, args.repo)
    test_invalid_org(args.url, args.token)
    test_invalid_batch(args.url, args.org, args.repo, args.token)
    test_download_success(args.url, args.org, args.repo, args.token)
    test_invalid_repo_name(args.url, args.org, args.token)
    test_batch_size_limit(args.url, args.org, args.repo, args.token)

    print(f"\n{BLUE}{'='*32}{RESET}")
    print(f"{BLUE}Summary{RESET}")
    print(f"{BLUE}{'='*32}{RESET}")
    print(f"{GREEN}Passed: {results['passed']}{RESET}")
    print(f"{RED}Failed: {results['failed']}{RESET}")
    print(f"{YELLOW}Skipped: {results['skipped']}{RESET}")
    sys.exit(1 if results["failed"] > 0 else 0)


if __name__ == "__main__":
    main()
