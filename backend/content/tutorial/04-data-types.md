---
title: Data types
order: 4
summary: Text, whole numbers, decimals and True/False, and how to tell them apart.
examples:
  - title: The four basic types
    code: |
      name = "Ana"        # str  (text)
      age = 19            # int  (whole number)
      height = 1.62       # float (decimal number)
      enrolled = True     # bool (True or False)
      print(type(name), type(age), type(height), type(enrolled))
  - title: Numbers and text are not the same
    code: |
      print(5 + 5)
      print("5" + "5")
  - title: Checking a type
    code: |
      value = 3.0
      print(type(value) == float)
exercise:
  prompt: |
    Four variables are given. Print the **type name** of each one, one per line, in the order
    `a`, `b`, `c`, `d`. Use `type(x).__name__` to get just the name (for example `int`).

    Expected output:

    ```
    str
    int
    float
    bool
    ```
  starter_code: |
    a = "15"
    b = 15
    c = 15.0
    d = False

    # Print the type name of each variable

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: Four type names
      stdin: ""
      expected_output: |
        str
        int
        float
        bool
      is_hidden: false
      match_mode: trim
    - name: One per line, exact
      stdin: ""
      expected_output: "str\nint\nfloat\nbool\n"
      is_hidden: false
      match_mode: exact
    - name: No extra text (hidden)
      stdin: ""
      expected_output: "str\nint\nfloat\nbool\n"
      is_hidden: true
      match_mode: exact
    - name: Order is a, b, c, d (hidden)
      stdin: ""
      expected_output: |
        str
        int
        float
        bool
      is_hidden: true
      match_mode: trim
  reference_solution: |
    a = "15"
    b = 15
    c = 15.0
    d = False

    print(type(a).__name__)
    print(type(b).__name__)
    print(type(c).__name__)
    print(type(d).__name__)
---
## Every value has a type

| Type | Name | Examples |
|---|---|---|
| text | `str` | `"Ana"`, `'BSIT'`, `"15"` |
| whole number | `int` | `0`, `19`, `-3` |
| decimal number | `float` | `1.62`, `3.0`, `-0.5` |
| true or false | `bool` | `True`, `False` |

`type(value)` tells you the type. `type(value).__name__` gives just the name as text.

## Why it matters

The same symbol can do different things depending on the types:

```python
print(5 + 5)       # 10      (numbers add)
print("5" + "5")   # 55      (texts join)
print("5" + 5)     # error:  cannot join text and a number
```

`"15"` is text, even though it looks like a number. You will learn to convert between types in lesson 7.

## Quick checks

- Anything between quotes is a `str`, including `"True"` and `"3.5"`.
- A number with a dot is a `float`, even `3.0`.
- `True` and `False` start with a capital letter. `true` is an error.
