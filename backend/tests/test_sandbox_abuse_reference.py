import sys, time
sys.path.insert(0, "app/worker")
from sandbox import run_in_sandbox, reap_orphans, client
cases = {
 "normal + import + csv + input": ([{"path":"Act2/main.py","content":"import helpers\nname=input()\nprint(helpers.greet(name))\nprint(open('data.csv').read().strip())"},
                     {"path":"Act2/helpers.py","content":"def greet(n): return 'Hello '+n"},
                     {"path":"Act2/data.csv","content":"a,b\n1,2"}], "Act2/main.py", "Nicole\n"),
 "syntax error": ([{"path":"m.py","content":"print('x'"}], "m.py", ""),
 "infinite loop": ([{"path":"m.py","content":"while True: pass"}], "m.py", ""),
 "print flood": ([{"path":"m.py","content":"while True: print('spam'*20)"}], "m.py", ""),
 "memory bomb": ([{"path":"m.py","content":"a=[]\nwhile True: a.append(' '*10_000_000)"}], "m.py", ""),
 "fork bomb": ([{"path":"m.py","content":"import os\nwhile True:\n  try: os.fork()\n  except OSError: pass"}], "m.py", ""),
 "network": ([{"path":"m.py","content":"import socket\nsocket.create_connection(('8.8.8.8',53),timeout=2)"}], "m.py", ""),
 "write outside": ([{"path":"m.py","content":"open('/opt/runner/boot.py','w').write('x')"}], "m.py", ""),
 "big file": ([{"path":"m.py","content":"open('/workspace/big','w').write('x'*5_000_000)"}], "m.py", ""),
}
for name,(files,entry,stdin) in cases.items():
    r = run_in_sandbox(files, entry, stdin)
    print(f"--- {name}: status={r.status} exit={r.exit_code} {r.duration_ms}ms out={r.output[-160:]!r}")
print("leftover containers:", len(client.containers.list(all=True, filters={'label':'lab-runner'})))
