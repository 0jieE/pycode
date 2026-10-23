---
title: Input and type casting
order: 7
summary: Ask the user for a value with input(), and turn text into numbers.
examples:
  - title: Reading text
    code: |
      name = input("What is your name? ")
      print("Nice to meet you,", name)
  - title: Reading a number
    code: |
      age = int(input("How old are you? "))
      print("Next year you will be", age + 1)
  - title: Converting between types
    code: |
      print(int("42") + 1)
      print(float("2.5") * 2)
      print(str(7) + "7")
exercise:
  prompt: |
    Read two whole numbers, one per line, and print their sum and their product:

    ```
    Sum: 7
    Product: 12
    ```

    (for the inputs `3` and `4`). Remember that `input()` gives you text: convert it with `int()`.
  starter_code: |
    first = input("First number: ")
    second = input("Second number: ")

    # Convert, then print the sum and the product

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: 3 and 4
      stdin: "3\n4\n"
      expected_output: |
        Sum: 7
        Product: 12
      is_hidden: false
      match_mode: trim
    - name: 10 and 0
      stdin: "10\n0\n"
      expected_output: |
        Sum: 10
        Product: 0
      is_hidden: false
      match_mode: trim
    - name: Negative numbers (hidden)
      stdin: "-5\n8\n"
      expected_output: |
        Sum: 3
        Product: -40
      is_hidden: true
      match_mode: trim
    - name: Big numbers (hidden)
      stdin: "1000\n1000\n"
      expected_output: |
        Sum: 2000
        Product: 1000000
      is_hidden: true
      match_mode: trim
  reference_solution: |
    first = int(input("First number: "))
    second = int(input("Second number: "))

    print("Sum:", first + second)
    print("Product:", first * second)
---
## Asking for input

`input()` pauses the program, waits for the user to type a line and press Enter, and gives you that line as text. The text in the parentheses is the prompt shown to the user:

```python
name = input("What is your name? ")
```

## input() always gives text

Even if the user types `18`, you get the string `"18"`. Doing math with it fails or gives the wrong result:

```python
age = input("Age: ")
print(age + 1)     # TypeError: can only concatenate str (not "int") to str
```

Convert it first. This is called **type casting**:

| Function | Turns the value into | Example |
|---|---|---|
| `int()` | a whole number | `int("18")` is `18` |
| `float()` | a decimal number | `float("1.5")` is `1.5` |
| `str()` | text | `str(18)` is `"18"` |

```python
age = int(input("Age: "))
print(age + 1)     # works
```

## When casting fails

`int("eighteen")` and `int("1.5")` raise a `ValueError`, because the text is not a whole number. Lesson 21 shows how to handle that.

## In the tutorial's checker

Prompts (the text inside `input(...)`) are not part of the output that is checked, so you can write any prompt you like.
