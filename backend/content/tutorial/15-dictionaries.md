---
title: Dictionaries
order: 15
summary: Look values up by a key instead of a position.
examples:
  - title: Keys and values
    code: |
      ages = {"Ana": 19, "Ben": 20}
      print(ages["Ana"])
      ages["Carl"] = 18
      print(len(ages))
  - title: Checking before looking up
    code: |
      ages = {"Ana": 19, "Ben": 20}
      name = "Dina"
      if name in ages:
          print(ages[name])
      else:
          print("Unknown")
      print(ages.get("Dina", 0))
  - title: Going through a dictionary
    code: |
      prices = {"pen": 12, "notebook": 45}
      for item, price in prices.items():
          print(item, "costs", price)
exercise:
  prompt: |
    A price list is given as a dictionary. Read an item name and print its price in this form:

    ```
    notebook: 45
    ```

    If the item is not in the price list, print `Not found`. The names are typed exactly as in the
    dictionary (lowercase).
  starter_code: |
    prices = {"pen": 12, "notebook": 45, "eraser": 8, "ruler": 20}

    item = input("Item: ")

    # Print "item: price", or "Not found"

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: notebook
      stdin: "notebook\n"
      expected_output: "notebook: 45"
      is_hidden: false
      match_mode: trim
    - name: An item that is not there
      stdin: "bag\n"
      expected_output: "Not found"
      is_hidden: false
      match_mode: trim
    - name: eraser (hidden)
      stdin: "eraser\n"
      expected_output: "eraser: 8"
      is_hidden: true
      match_mode: trim
    - name: Case matters (hidden)
      stdin: "Pen\n"
      expected_output: "Not found"
      is_hidden: true
      match_mode: trim
  reference_solution: |
    prices = {"pen": 12, "notebook": 45, "eraser": 8, "ruler": 20}

    item = input("Item: ")

    if item in prices:
        print(item + ": " + str(prices[item]))
    else:
        print("Not found")
---
## Keys and values

A dictionary stores pairs: each **key** points to a **value**. You look values up by key, not by position:

```python
ages = {"Ana": 19, "Ben": 20}
print(ages["Ana"])      # 19
```

Keys are usually strings or numbers, and each key appears only once. Values can be anything.

## Changing a dictionary

| Code | Effect |
|---|---|
| `ages["Carl"] = 18` | add a pair, or change it if the key exists |
| `del ages["Ben"]` | remove a pair |
| `ages.get("Dina", 0)` | the value, or `0` if the key is missing |
| `"Ana" in ages` | True if the key exists |
| `len(ages)` | how many pairs |

Looking up a key that does not exist with `ages["Dina"]` raises a `KeyError`. Check with `in` first, or use `.get()`.

## Going through a dictionary

```python
for name in ages:                   # the keys
    print(name, ages[name])

for name, age in ages.items():      # keys and values together
    print(name, age)
```

`ages.keys()` and `ages.values()` give only one side.

## When to use what

- A **list** when the order matters and you reach items by position.
- A **dictionary** when you reach items by a name or an id.
