---
title: Tuples
order: 14
summary: Lists that cannot change, for values that belong together.
examples:
  - title: A tuple of coordinates
    code: |
      point = (3, 4)
      print(point)
      print(point[0], point[1])
  - title: Unpacking
    code: |
      student = ("Ana", 19, "BSIT")
      name, age, course = student
      print(name, "is", age, "and takes", course)
  - title: Tuples cannot change
    code: |
      days = ("Mon", "Tue", "Wed")
      print(len(days))
      print("Tue" in days)
      # days[0] = "Sun"   would be an error
exercise:
  prompt: |
    Read two whole numbers `x` and `y` (one per line). Put them in a tuple called `point`, print it,
    then make a new tuple with the two values swapped and print that too:

    ```
    Point: (3, 4)
    Swapped: (4, 3)
    ```

    Print the tuples themselves (`print("Point:", point)`); Python shows the parentheses for you.
  starter_code: |
    x = int(input("x: "))
    y = int(input("y: "))

    # Make the tuple, print it, then the swapped one

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: 3 and 4
      stdin: "3\n4\n"
      expected_output: |
        Point: (3, 4)
        Swapped: (4, 3)
      is_hidden: false
      match_mode: trim
    - name: 0 and -1
      stdin: "0\n-1\n"
      expected_output: |
        Point: (0, -1)
        Swapped: (-1, 0)
      is_hidden: false
      match_mode: trim
    - name: Same values (hidden)
      stdin: "7\n7\n"
      expected_output: |
        Point: (7, 7)
        Swapped: (7, 7)
      is_hidden: true
      match_mode: trim
    - name: Big values (hidden)
      stdin: "1000\n25\n"
      expected_output: |
        Point: (1000, 25)
        Swapped: (25, 1000)
      is_hidden: true
      match_mode: trim
  reference_solution: |
    x = int(input("x: "))
    y = int(input("y: "))

    point = (x, y)
    print("Point:", point)
    swapped = (point[1], point[0])
    print("Swapped:", swapped)
---
## What a tuple is

A tuple is like a list, but written with parentheses and **cannot be changed** after it is made:

```python
point = (3, 4)
rgb = (255, 128, 0)
```

Reading works the same as with lists: `point[0]`, `len(point)`, `3 in point`, slices, `for` loops.

## Why use a tuple instead of a list?

- For a fixed group of values that belong together, such as a coordinate or a date (`(2026, 10, 11)`).
- To make sure nothing changes it by accident.
- Functions often return several values as a tuple (lesson 18).

## Unpacking

You can take a tuple apart into separate variables in one line:

```python
name, age = ("Ana", 19)
```

This also works for swapping two variables without a temporary one:

```python
a, b = b, a
```

## One-item tuples

`(5)` is just the number 5. A tuple with one item needs a comma: `(5,)`.
