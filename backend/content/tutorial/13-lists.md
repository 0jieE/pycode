---
title: Lists
order: 13
summary: Keep many values in one variable, in order.
examples:
  - title: Making a list and reading items
    code: |
      fruits = ["apple", "banana", "mango"]
      print(fruits[0])
      print(fruits[-1])
      print(len(fruits))
  - title: Adding, changing, removing
    code: |
      scores = [80, 95]
      scores.append(70)
      scores[0] = 85
      scores.remove(95)
      print(scores)
  - title: Going through a list
    code: |
      prices = [12.5, 3.0, 7.25]
      total = 0
      for price in prices:
          total += price
      print("Total:", total)
      print("Sorted:", sorted(prices))
exercise:
  prompt: |
    Read five whole numbers, one per line, into a list. Then print the largest, the smallest and the
    sum of the numbers:

    ```
    Max: 9
    Min: 2
    Sum: 25
    ```

    for the input `4`, `9`, `2`, `7`, `3`. Use `append()` in a loop to build the list, then
    `max()`, `min()` and `sum()`.
  starter_code: |
    numbers = []

    # Read five numbers into the list

    # Print Max, Min and Sum

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: 4 9 2 7 3
      stdin: "4\n9\n2\n7\n3\n"
      expected_output: |
        Max: 9
        Min: 2
        Sum: 25
      is_hidden: false
      match_mode: trim
    - name: All the same
      stdin: "5\n5\n5\n5\n5\n"
      expected_output: |
        Max: 5
        Min: 5
        Sum: 25
      is_hidden: false
      match_mode: trim
    - name: Negative numbers (hidden)
      stdin: "-3\n0\n-8\n2\n-1\n"
      expected_output: |
        Max: 2
        Min: -8
        Sum: -10
      is_hidden: true
      match_mode: trim
    - name: Largest number first (hidden)
      stdin: "100\n1\n2\n3\n4\n"
      expected_output: |
        Max: 100
        Min: 1
        Sum: 110
      is_hidden: true
      match_mode: trim
  reference_solution: |
    numbers = []

    for i in range(5):
        numbers.append(int(input("Number: ")))

    print("Max:", max(numbers))
    print("Min:", min(numbers))
    print("Sum:", sum(numbers))
---
## What a list is

A list holds several values in order, inside square brackets:

```python
fruits = ["apple", "banana", "mango"]
empty = []
```

Items are reached by position, starting at 0, exactly like the characters of a string: `fruits[0]`, `fruits[-1]`, `fruits[0:2]`.

## Changing a list

Unlike strings, lists can be changed:

| Code | Effect |
|---|---|
| `fruits.append("kiwi")` | add at the end |
| `fruits.insert(0, "kiwi")` | add at a position |
| `fruits[1] = "pear"` | replace an item |
| `fruits.remove("apple")` | remove the first `"apple"` |
| `fruits.pop()` | remove and return the last item |
| `del fruits[0]` | remove by position |

## Useful functions

`len(list)`, `sum(list)`, `max(list)`, `min(list)`, `sorted(list)` (a new sorted list), `list.sort()` (sorts in place), `"x" in list` (True if found).

## Going through a list

```python
for fruit in fruits:
    print(fruit)
```

If you also need the position, use `enumerate`:

```python
for i, fruit in enumerate(fruits):
    print(i, fruit)
```
