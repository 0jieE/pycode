"""How many sandbox runs per second can THIS server's Docker sustain? Run it inside the worker container:

    docker compose exec worker python -m loadtest.bench_sandbox --concurrency 8 --runs 120
    docker compose exec worker python -m loadtest.bench_sandbox --sweep       # tries 4, 6, 8, 10, 12

Use it to choose CELERY_CONCURRENCY: pick the smallest value after which runs/s stops improving.
(Needs the Docker socket, so it only works in the `worker` container.)
"""
import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor

CODE = "total = sum(i * i for i in range(200_000))\nprint('sum of squares:', total)\n"
FILES = [{"path": "m.py", "content": CODE, "is_folder": False}]


def available_mb() -> int:
    info = dict(line.split(":", 1) for line in open("/proc/meminfo"))
    return int(info["MemAvailable"].split()[0]) // 1024


def bench(concurrency: int, runs: int) -> None:
    from app.worker.sandbox import run_in_sandbox

    def one(_: int):
        r = run_in_sandbox(FILES, "m.py")
        return r.duration_ms, r.status

    started = time.time()
    with ThreadPoolExecutor(concurrency) as pool:
        results = list(pool.map(one, range(runs)))
    wall = time.time() - started
    ms = sorted(d for d, _ in results)
    bad = sum(1 for _, s in results if s != "ok")
    sys.stdout.write(
        f"concurrency {concurrency:>2}: {runs} runs in {wall:5.1f} s = {runs / wall:4.1f} runs/s | "
        f"per run p50 {ms[len(ms) // 2]} ms, p95 {ms[int(len(ms) * 0.95)]} ms, max {ms[-1]} ms | "
        f"not ok: {bad} | free RAM {available_mb()} MB\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--runs", type=int, default=120)
    parser.add_argument("--sweep", action="store_true", help="try 4, 6, 8, 10 and 12 in turn")
    args = parser.parse_args()
    for c in ([4, 6, 8, 10, 12] if args.sweep else [args.concurrency]):
        bench(c, args.runs)


if __name__ == "__main__":
    main()
