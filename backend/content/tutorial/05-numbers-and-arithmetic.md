---
title: Numbers and arithmetic
order: 5
summary: Add, subtract, multiply, divide, and the two kinds of division.
examples:
  - title: The basic operators
    code: |
      print(7 + 3)
      print(7 - 3)
      print(7 * 3)
      print(7 / 2)
  - title: Whole-number division and remainder
    code: |
      print(7 // 2)   # how many times 2 fits in 7
      print(7 % 2)    # what is left over
      print(2 ** 10)  # 2 to the power of 10
  - title: Order of operations
    code: |
      print(2 + 3 * 4)
      print((2 + 3) * 4)
exercise:
  prompt: |
    A box holds 12 eggs. Given a number of eggs in the variable `eggs`, print how many **full boxes**
    you can fill and how many eggs are **left over**, in this form:

    ```
    Boxes: 3
    Left over: 4
    ```

    Change nothing but the two `print` lines. Compute the numbers from `eggs` with `//` and `%`;
    do not type them in, so that the program still works when `eggs` changes.
  starter_code: |
    eggs = 40

    # Print the number of full boxes and the eggs left over

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: 40 eggs
      stdin: ""
      expected_output: |
        Boxes: 3
        Left over: 4
      is_hidden: false
      match_mode: trim
    - name: Exact format
      stdin: ""
      expected_output: "Boxes: 3\nLeft over: 4\n"
      is_hidden: false
      match_mode: exact
    - name: Uses // and % (hidden)
      stdin: ""
      expected_output: |
        Boxes: 3
        Left over: 4
      is_hidden: true
      match_mode: exact
    - name: Whole numbers, not decimals (hidden)
      stdin: ""
      expected_output: "Boxes: 3\nLeft over: 4"
      is_hidden: true
      match_mode: trim
  reference_solution: |
    eggs = 40

    print("Boxes:", eggs // 12)
    print("Left over:", eggs % 12)
---
## The operators

| Symbol | Meaning | Example | Result |
|---|---|---|---|
| `+` | add | `7 + 3` | `10` |
| `-` | subtract | `7 - 3` | `4` |
| `*` | multiply | `7 * 3` | `21` |
| `/` | divide | `7 / 2` | `3.5` |
| `//` | divide, keep the whole part | `7 // 2` | `3` |
| `%` | remainder | `7 % 2` | `1` |
| `**` | power | `2 ** 3` | `8` |

## Two kinds of division

`/` always gives a `float`, even when it divides evenly: `8 / 2` is `4.0`.
`//` gives the whole number of times one fits in the other, and `%` gives what is left. Together they answer "how many groups, and how many left over?":

```python
print(17 // 5)   # 3
print(17 % 5)    # 2
```

## Order of operations

Python follows the rules you know from math: `**` first, then `*`, `/`, `//`, `%`, then `+` and `-`. Use parentheses to change the order or just to make the code clearer.

## Shortcuts

`total = total + 5` can be written `total += 5`. The same works for `-=`, `*=` and `/=`.
