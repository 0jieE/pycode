---
title: Handling errors with try and except
order: 21
summary: Keep the program running when something goes wrong.
examples:
  - title: Catching a bad number
    code: |
      text = "abc"
      try:
          number = int(text)
          print("Twice:", number * 2)
      except ValueError:
          print("That is not a whole number")
  - title: Division by zero
    code: |
      a, b = 10, 0
      try:
          print(a / b)
      except ZeroDivisionError:
          print("Cannot divide by zero")
  - title: else and finally
    code: |
      try:
          value = int("42")
      except ValueError:
          print("bad input")
      else:
          print("parsed", value)
      finally:
          print("done")
exercise:
  prompt: |
    Read two values, one per line, and print their quotient (`first / second`). Handle the two things
    that can go wrong:

    - if either value is not a whole number, print `Invalid number`;
    - if the second value is zero, print `Cannot divide by zero`.

    Otherwise print `Result: ` followed by the quotient. For `10` and `4`:

    ```
    Result: 2.5
    ```
  starter_code: |
    first = input("First: ")
    second = input("Second: ")

    # Convert and divide inside a try block

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: 10 and 4
      stdin: "10\n4\n"
      expected_output: "Result: 2.5"
      is_hidden: false
      match_mode: trim
    - name: Division by zero
      stdin: "7\n0\n"
      expected_output: "Cannot divide by zero"
      is_hidden: false
      match_mode: trim
    - name: Text instead of a number (hidden)
      stdin: "ten\n2\n"
      expected_output: "Invalid number"
      is_hidden: true
      match_mode: trim
    - name: A decimal is not a whole number (hidden)
      stdin: "8\n2.5\n"
      expected_output: "Invalid number"
      is_hidden: true
      match_mode: trim
  reference_solution: |
    first = input("First: ")
    second = input("Second: ")

    try:
        a = int(first)
        b = int(second)
        print("Result:", a / b)
    except ValueError:
        print("Invalid number")
    except ZeroDivisionError:
        print("Cannot divide by zero")
---
## Errors stop the program

When something impossible happens, Python raises an **exception** and, if nothing catches it, the program stops with a traceback:

```python
number = int("abc")      # ValueError: invalid literal for int()
print(10 / 0)            # ZeroDivisionError: division by zero
```

## try and except

Put the risky lines in a `try` block and say what to do if a given error happens:

```python
try:
    number = int(input("Number: "))
except ValueError:
    print("That is not a whole number")
```

If the `try` block raises a `ValueError`, Python jumps to the `except` block and the program goes on. If no error happens, the `except` block is skipped.

## Several kinds of error

Use one `except` per kind, in the order you want them checked:

```python
try:
    ...
except ValueError:
    ...
except ZeroDivisionError:
    ...
```

Catching every error with a bare `except:` hides bugs. Name the errors you expect.

## else and finally

- `else` runs when the `try` block finished without an error.
- `finally` always runs, error or not. It is used for cleanup, such as closing a file.

## Common exceptions

| Name | When |
|---|---|
| `ValueError` | a conversion gets the wrong kind of text |
| `ZeroDivisionError` | dividing by 0 |
| `IndexError` | a list position that does not exist |
| `KeyError` | a dictionary key that does not exist |
| `TypeError` | mixing types, like `"a" + 1` |
