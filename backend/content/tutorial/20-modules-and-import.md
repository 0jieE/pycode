---
title: Modules and import
order: 20
summary: Use code from other files and from Python's standard library.
examples:
  - title: The math module
    code: |
      import math

      print(math.sqrt(16))
      print(math.pi)
      print(math.floor(3.7))
  - title: Importing one name
    code: |
      from random import randint

      print(randint(1, 6) in range(1, 7))
  - title: Your own module (helpers.py in the same folder)
    code: |
      # helpers.py:
      #     def shout(text):
      #         return text.upper() + "!"
      #
      # main.py:
      #     import helpers
      #     print(helpers.shout("hello"))
      print("See the exercise: it uses a helpers.py file")
exercise:
  prompt: |
    This exercise has two files. `helpers.py` is complete and must not be changed. It defines:

    - `celsius_to_fahrenheit(celsius)` which returns the temperature in Fahrenheit,
    - `is_hot(celsius)` which returns `True` when the temperature is 30 or more.

    In `main.py`, import the module, read a temperature in Celsius (a whole number) and print:

    ```
    Fahrenheit: 86.0
    Hot: True
    ```

    for the input `30`.
  starter_code: |
    # Import helpers, read the temperature, print Fahrenheit and Hot

  starter_files:
    - path: helpers.py
      content: |
        """Temperature helpers. Do not change this file."""


        def celsius_to_fahrenheit(celsius):
            return celsius * 9 / 5 + 32


        def is_hot(celsius):
            return celsius >= 30
  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: 30 degrees
      stdin: "30\n"
      expected_output: |
        Fahrenheit: 86.0
        Hot: True
      is_hidden: false
      match_mode: trim
    - name: 0 degrees
      stdin: "0\n"
      expected_output: |
        Fahrenheit: 32.0
        Hot: False
      is_hidden: false
      match_mode: trim
    - name: 29 is not hot (hidden)
      stdin: "29\n"
      expected_output: |
        Fahrenheit: 84.2
        Hot: False
      is_hidden: true
      match_mode: trim
    - name: Negative temperature (hidden)
      stdin: "-40\n"
      expected_output: |
        Fahrenheit: -40.0
        Hot: False
      is_hidden: true
      match_mode: trim
  reference_solution: |
    import helpers

    celsius = int(input("Celsius: "))
    print("Fahrenheit:", helpers.celsius_to_fahrenheit(celsius))
    print("Hot:", helpers.is_hot(celsius))
---
## What a module is

A module is a Python file whose functions you can use from another file. `import` loads it:

```python
import math
print(math.sqrt(16))    # 4.0
```

After `import math`, everything in the module is reached as `math.something`.

## Two ways to import

```python
import math                 # use math.sqrt(16)
from math import sqrt       # use sqrt(16) directly
from math import sqrt, pi   # several names
```

`from ... import` is shorter, but `import math` makes it clear where a function comes from.

## The standard library

Python comes with many modules that need no installation. Some you will meet often:

| Module | For |
|---|---|
| `math` | `sqrt`, `floor`, `ceil`, `pi` |
| `random` | `randint`, `choice`, `shuffle` |
| `datetime` | dates and times |
| `os` | files and folders |

## Your own modules

Any `.py` file in the same folder is a module. If `helpers.py` defines `shout()`, then `main.py` can do:

```python
import helpers
print(helpers.shout("hi"))
```

Splitting a program into files keeps each one short and lets you reuse the helpers elsewhere.

## Running a module directly

When a file is run directly, Python sets `__name__` to `"__main__"`; when it is imported, `__name__` is the file's name. The common pattern

```python
if __name__ == "__main__":
    main()
```

runs `main()` only when the file is started directly, not when another file imports it.
