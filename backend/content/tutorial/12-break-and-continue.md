---
title: break and continue
order: 12
summary: Leave a loop early, or skip to the next round.
examples:
  - title: break stops the loop
    code: |
      for i in range(1, 100):
          if i * i > 50:
              break
          print(i)
      print("stopped at", i)
  - title: continue skips one round
    code: |
      for i in range(1, 11):
          if i % 3 == 0:
              continue
          print(i)
  - title: A loop that waits for a sentinel
    code: |
      while True:
          word = input("Word (or quit): ")
          if word == "quit":
              break
          print("You typed", word)
exercise:
  prompt: |
    Read whole numbers, one per line, until the number `0` is entered (the `0` itself is not counted).
    Add up only the **positive** numbers, skipping negative ones, and print the total:

    ```
    Sum: 12
    ```

    for the input `5`, `-2`, `7`, `0`. Use `break` to stop at 0 and `continue` to skip negatives.
  starter_code: |
    total = 0

    while True:
        number = int(input("Number: "))
        # stop at 0, skip negatives, add the rest

    print("Sum:", total)
  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: 5, -2, 7, 0
      stdin: "5\n-2\n7\n0\n"
      expected_output: "Sum: 12"
      is_hidden: false
      match_mode: trim
    - name: Only a 0
      stdin: "0\n"
      expected_output: "Sum: 0"
      is_hidden: false
      match_mode: trim
    - name: All negatives (hidden)
      stdin: "-1\n-9\n-3\n0\n"
      expected_output: "Sum: 0"
      is_hidden: true
      match_mode: trim
    - name: Numbers after the 0 are ignored (hidden)
      stdin: "4\n6\n0\n100\n"
      expected_output: "Sum: 10"
      is_hidden: true
      match_mode: trim
  reference_solution: |
    total = 0

    while True:
        number = int(input("Number: "))
        if number == 0:
            break
        if number < 0:
            continue
        total += number

    print("Sum:", total)
---
## break: leave the loop now

`break` ends the loop immediately, even if the condition is still true or there are items left. The program continues after the loop:

```python
for i in range(1, 100):
    if i * i > 50:
        break
    print(i)
```

## continue: skip the rest of this round

`continue` jumps straight to the next round of the loop, skipping the lines below it:

```python
for i in range(1, 11):
    if i % 3 == 0:
        continue      # 3, 6 and 9 are not printed
    print(i)
```

## The sentinel pattern

A common use of `break` is reading input until a special value (a *sentinel*) is entered:

```python
while True:
    line = input()
    if line == "done":
        break
    ...
```

`while True` would run forever; the `break` is the exit.

## Only the innermost loop

If loops are nested, `break` and `continue` affect only the loop they are directly inside.
