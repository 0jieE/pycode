---
title: Repeating with for and range
order: 11
summary: Repeat a block a known number of times, or once for each item.
examples:
  - title: range gives the numbers 0, 1, 2, ...
    code: |
      for i in range(5):
          print(i)
  - title: A start, an end and a step
    code: |
      for i in range(1, 11, 2):
          print(i)
  - title: Once for each character
    code: |
      for letter in "abc":
          print(letter.upper())
exercise:
  prompt: |
    Read a whole number `n` and print its multiplication table from 1 to 10, one line per product,
    in this form (for the input `3`):

    ```
    3 x 1 = 3
    3 x 2 = 6
    ...
    3 x 10 = 30
    ```

    Use a `for` loop with `range`.
  starter_code: |
    n = int(input("Number: "))

    # Print the table with a for loop

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: Table of 3
      stdin: "3\n"
      expected_output: |
        3 x 1 = 3
        3 x 2 = 6
        3 x 3 = 9
        3 x 4 = 12
        3 x 5 = 15
        3 x 6 = 18
        3 x 7 = 21
        3 x 8 = 24
        3 x 9 = 27
        3 x 10 = 30
      is_hidden: false
      match_mode: trim
    - name: Table of 1
      stdin: "1\n"
      expected_output: |
        1 x 1 = 1
        1 x 2 = 2
        1 x 3 = 3
        1 x 4 = 4
        1 x 5 = 5
        1 x 6 = 6
        1 x 7 = 7
        1 x 8 = 8
        1 x 9 = 9
        1 x 10 = 10
      is_hidden: false
      match_mode: trim
    - name: Table of 12 (hidden)
      stdin: "12\n"
      expected_output: |
        12 x 1 = 12
        12 x 2 = 24
        12 x 3 = 36
        12 x 4 = 48
        12 x 5 = 60
        12 x 6 = 72
        12 x 7 = 84
        12 x 8 = 96
        12 x 9 = 108
        12 x 10 = 120
      is_hidden: true
      match_mode: trim
    - name: Table of 0 (hidden)
      stdin: "0\n"
      expected_output: |
        0 x 1 = 0
        0 x 2 = 0
        0 x 3 = 0
        0 x 4 = 0
        0 x 5 = 0
        0 x 6 = 0
        0 x 7 = 0
        0 x 8 = 0
        0 x 9 = 0
        0 x 10 = 0
      is_hidden: true
      match_mode: trim
  reference_solution: |
    n = int(input("Number: "))

    for i in range(1, 11):
        print(n, "x", i, "=", n * i)
---
## The for loop

A `for` loop runs its block once for each item of something, with the loop variable taking each value in turn:

```python
for letter in "abc":
    print(letter)
```

## range()

`range()` produces a sequence of whole numbers, which makes `for` perfect for "repeat N times":

| Call | Numbers |
|---|---|
| `range(5)` | 0, 1, 2, 3, 4 |
| `range(1, 6)` | 1, 2, 3, 4, 5 |
| `range(0, 10, 2)` | 0, 2, 4, 6, 8 |
| `range(5, 0, -1)` | 5, 4, 3, 2, 1 |

The end value is **not** included, just like in slices. `range(1, 11)` is the way to get 1 to 10.

```python
for i in range(1, 11):
    print(i)
```

## for or while?

- `for` when you know how many times, or want to go through every item of something.
- `while` when you repeat until something happens and do not know when that is.

## A running total

A common pattern is a variable that collects a result inside the loop:

```python
total = 0
for i in range(1, 101):
    total += i
print(total)   # 5050
```
