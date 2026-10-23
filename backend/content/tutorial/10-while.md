---
title: Repeating with while
order: 10
summary: Run a block again and again while a condition stays true.
examples:
  - title: Counting up
    code: |
      count = 1
      while count <= 5:
          print(count)
          count = count + 1
  - title: Adding until a total is reached
    code: |
      total = 0
      number = 1
      while total < 20:
          total = total + number
          number = number + 1
      print("Total:", total)
  - title: Repeating until the right answer
    code: |
      answer = input("Type yes to continue: ")
      while answer != "yes":
          answer = input("Type yes to continue: ")
      print("Continuing")
exercise:
  prompt: |
    Read a whole number `n` and print a countdown from `n` down to `1`, one number per line, then
    the word `Liftoff!`. For the input `3`:

    ```
    3
    2
    1
    Liftoff!
    ```

    If `n` is 0, only `Liftoff!` is printed. Use a `while` loop.
  starter_code: |
    n = int(input("Start from: "))

    # Count down with a while loop, then print Liftoff!

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: From 3
      stdin: "3\n"
      expected_output: |
        3
        2
        1
        Liftoff!
      is_hidden: false
      match_mode: trim
    - name: From 1
      stdin: "1\n"
      expected_output: |
        1
        Liftoff!
      is_hidden: false
      match_mode: trim
    - name: From 0 (hidden)
      stdin: "0\n"
      expected_output: "Liftoff!"
      is_hidden: true
      match_mode: trim
    - name: From 6 (hidden)
      stdin: "6\n"
      expected_output: |
        6
        5
        4
        3
        2
        1
        Liftoff!
      is_hidden: true
      match_mode: trim
  reference_solution: |
    n = int(input("Start from: "))

    while n > 0:
        print(n)
        n = n - 1
    print("Liftoff!")
---
## How while works

```python
count = 1
while count <= 5:
    print(count)
    count = count + 1
```

1. Python checks the condition `count <= 5`.
2. If it is true, it runs the indented block, then goes back to step 1.
3. If it is false, it skips the block and continues after the loop.

The block must change something that the condition depends on; otherwise the loop never ends.

## Infinite loops

```python
while True:
    print("forever")
```

This never stops on its own. In the tutorial the sandbox stops it after 10 seconds of CPU time, but on your own computer you would have to kill the program. Lesson 12 shows `break`, the controlled way out of such a loop.

## The pattern: counter, condition, step

Most `while` loops have three parts:

```python
i = 0              # start
while i < 10:      # keep going while...
    ...
    i += 1         # step (do not forget this one!)
```

If you know in advance how many times to repeat, a `for` loop (next lesson) is shorter.
