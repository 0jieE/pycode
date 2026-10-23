---
title: Sets
order: 16
summary: A collection with no duplicates and no order.
examples:
  - title: Duplicates disappear
    code: |
      votes = ["ana", "ben", "ana", "carl", "ben"]
      unique = set(votes)
      print(len(unique))
      print(sorted(unique))
  - title: Adding and testing membership
    code: |
      seen = set()
      seen.add("apple")
      seen.add("apple")
      seen.add("mango")
      print(seen == {"apple", "mango"})
      print("mango" in seen)
  - title: Set operations
    code: |
      a = {1, 2, 3, 4}
      b = {3, 4, 5}
      print(a & b)   # in both
      print(a | b)   # in either
      print(a - b)   # in a but not in b
exercise:
  prompt: |
    Read six whole numbers, one per line. Some may repeat. Print how many **different** numbers there
    are, and the different numbers in increasing order:

    ```
    Distinct: 4
    Values: [1, 2, 3, 5]
    ```

    for the input `3`, `1`, `3`, `5`, `2`, `1`. Collect the numbers in a set, then print
    `sorted(...)` of it.
  starter_code: |
    numbers = set()

    # Read six numbers into the set

    # Print Distinct and Values

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: 3 1 3 5 2 1
      stdin: "3\n1\n3\n5\n2\n1\n"
      expected_output: |
        Distinct: 4
        Values: [1, 2, 3, 5]
      is_hidden: false
      match_mode: trim
    - name: All different
      stdin: "6\n5\n4\n3\n2\n1\n"
      expected_output: |
        Distinct: 6
        Values: [1, 2, 3, 4, 5, 6]
      is_hidden: false
      match_mode: trim
    - name: All the same (hidden)
      stdin: "7\n7\n7\n7\n7\n7\n"
      expected_output: |
        Distinct: 1
        Values: [7]
      is_hidden: true
      match_mode: trim
    - name: Negative numbers (hidden)
      stdin: "-1\n0\n-1\n2\n0\n-5\n"
      expected_output: |
        Distinct: 4
        Values: [-5, -1, 0, 2]
      is_hidden: true
      match_mode: trim
  reference_solution: |
    numbers = set()

    for i in range(6):
        numbers.add(int(input("Number: ")))

    print("Distinct:", len(numbers))
    print("Values:", sorted(numbers))
---
## What a set is

A set is a collection where every value appears **once** and the order does not matter:

```python
colors = {"red", "blue", "red"}
print(colors)      # {'red', 'blue'}  (in some order)
```

`set(a_list)` makes a set from a list, which is the quickest way to remove duplicates. An empty set is `set()`, because `{}` is an empty dictionary.

## Changing a set

| Code | Effect |
|---|---|
| `s.add(x)` | add (nothing happens if it is already there) |
| `s.remove(x)` | remove (error if missing) |
| `s.discard(x)` | remove if present |
| `x in s` | True if present (very fast, even for big sets) |
| `len(s)` | how many |

Sets have no positions: `s[0]` is an error. To get the items in order, use `sorted(s)`.

## Set operations

| Code | Meaning |
|---|---|
| `a & b` | items in both |
| `a \| b` | items in either |
| `a - b` | items in a that are not in b |

Useful for questions like "which students submitted both activities?".
