---
title: "Bonus: linear search"
order: 25
summary: Find an item in a list by looking at each one in turn.
examples:
  - title: Searching by hand
    code: |
      numbers = [4, 8, 15, 16, 23, 42]
      target = 16
      position = -1
      for i in range(len(numbers)):
          if numbers[i] == target:
              position = i
              break
      print("Found at", position)
  - title: As a function
    code: |
      def linear_search(items, target):
          for i, item in enumerate(items):
              if item == target:
                  return i
          return -1

      print(linear_search(["pen", "ink", "cap"], "ink"))
      print(linear_search(["pen", "ink", "cap"], "hat"))
  - title: Python's built-in way
    code: |
      names = ["Ana", "Ben", "Carl"]
      print("Ben" in names)
      print(names.index("Ben"))
exercise:
  prompt: |
    Write `linear_search(numbers, target)` that returns the **position** (starting at 0) of the first
    element equal to `target`, or `-1` if it is not in the list.

    The program reads how many numbers there are, then the numbers one per line, then the target,
    and prints `Found at <position>` or `Not found`. For `4`, then `7 3 9 3`, then `3`:

    ```
    Found at 1
    ```

    Write the search yourself with a loop; do not use `in` or `.index()`.
  starter_code: |
    def linear_search(numbers, target):
        # Return the index of the first element equal to target, or -1
        return -1


    count = int(input("How many numbers: "))
    numbers = []
    for i in range(count):
        numbers.append(int(input("Number: ")))
    target = int(input("Target: "))

    position = linear_search(numbers, target)
    if position == -1:
        print("Not found")
    else:
        print("Found at", position)
  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: Found at 1
      stdin: "4\n7\n3\n9\n3\n3\n"
      expected_output: "Found at 1"
      is_hidden: false
      match_mode: trim
    - name: Not found
      stdin: "3\n1\n2\n3\n4\n"
      expected_output: "Not found"
      is_hidden: false
      match_mode: trim
    - name: The last element (hidden)
      stdin: "5\n10\n20\n30\n40\n50\n50\n"
      expected_output: "Found at 4"
      is_hidden: true
      match_mode: trim
    - name: An empty list (hidden)
      stdin: "0\n5\n"
      expected_output: "Not found"
      is_hidden: true
      match_mode: trim
  reference_solution: |
    def linear_search(numbers, target):
        for i in range(len(numbers)):
            if numbers[i] == target:
                return i
        return -1


    count = int(input("How many numbers: "))
    numbers = []
    for i in range(count):
        numbers.append(int(input("Number: ")))
    target = int(input("Target: "))

    position = linear_search(numbers, target)
    if position == -1:
        print("Not found")
    else:
        print("Found at", position)
---
## The idea

To find something in a list, look at the first item, then the second, and so on, until you find it or reach the end. This is **linear search**: simple, and it works on any list, sorted or not.

```python
def linear_search(items, target):
    for i in range(len(items)):
        if items[i] == target:
            return i          # found: stop right here
    return -1                 # the loop finished without finding it
```

Two things to notice:

- `return` inside the loop ends the search as soon as the item is found; the rest of the list is not looked at.
- The `return -1` after the loop runs only when nothing matched. `-1` is a common way to say "not found", because no real position is negative.

## How long does it take?

In the worst case (the item is last, or missing) every element is checked. For 1,000,000 items that is 1,000,000 comparisons. Faster searches exist for *sorted* lists (binary search), which you will meet in Data Structures.

## Python already has it

`target in items` and `items.index(target)` do a linear search for you. Writing it yourself once shows what they are doing, and the same loop pattern is the base of many other algorithms: finding the largest item, counting matches, checking whether a list has duplicates.
