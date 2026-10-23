---
title: Making decisions with if, elif and else
order: 9
summary: Run some lines only when a condition is true.
examples:
  - title: if and else
    code: |
      score = 75
      if score >= 60:
          print("Passed")
      else:
          print("Failed")
  - title: Several cases with elif
    code: |
      temperature = 31
      if temperature >= 35:
          print("Very hot")
      elif temperature >= 28:
          print("Hot")
      elif temperature >= 20:
          print("Pleasant")
      else:
          print("Cool")
  - title: Only an if
    code: |
      items = 12
      if items > 10:
          print("Big order")
      print("Done")
exercise:
  prompt: |
    Read a score from 0 to 100 and print its letter grade on one line:

    | Score | Grade |
    |---|---|
    | 90 to 100 | `A` |
    | 80 to 89 | `B` |
    | 70 to 79 | `C` |
    | 60 to 69 | `D` |
    | below 60 | `F` |

    For example, the input `85` prints `B`.
  starter_code: |
    score = int(input("Score: "))

    # Print the letter grade

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: 85 is a B
      stdin: "85\n"
      expected_output: "B"
      is_hidden: false
      match_mode: trim
    - name: 42 is an F
      stdin: "42\n"
      expected_output: "F"
      is_hidden: false
      match_mode: trim
    - name: Boundary 90 (hidden)
      stdin: "90\n"
      expected_output: "A"
      is_hidden: true
      match_mode: trim
    - name: Boundary 69 (hidden)
      stdin: "69\n"
      expected_output: "D"
      is_hidden: true
      match_mode: trim
  reference_solution: |
    score = int(input("Score: "))

    if score >= 90:
        print("A")
    elif score >= 80:
        print("B")
    elif score >= 70:
        print("C")
    elif score >= 60:
        print("D")
    else:
        print("F")
---
## The if statement

```python
if score >= 60:
    print("Passed")
```

The line after `if` ends with a colon, and the lines that belong to it are **indented** (moved right by 4 spaces). Python runs them only when the condition is true. The indented lines are called a *block*.

## else and elif

`else` runs when the condition was false. `elif` ("else if") checks another condition. Python goes down the list and runs the **first** block whose condition is true, then skips the rest:

```python
if score >= 90:
    print("A")
elif score >= 80:
    print("B")
else:
    print("C or lower")
```

Because the first matching block wins, the order matters. Checking `score >= 80` before `score >= 90` would give every A student a B.

## Indentation is the syntax

Python uses the indentation to know which lines belong to the `if`. Use 4 spaces, always the same amount, and never mix tabs and spaces:

```python
if x > 0:
    print("positive")   # inside the if
print("always")         # outside: runs every time
```

## Conditions can be anything that is True or False

A comparison, a boolean variable, or a combination with `and`, `or`, `not` (lesson 8).
