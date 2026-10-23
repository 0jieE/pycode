---
title: Printing output
order: 1
summary: Show text and numbers on the screen with print().
examples:
  - title: Your first program
    code: |
      print("Hello, world!")
  - title: Printing several things
    code: |
      print("The answer is", 42)
      print("One")
      print("Two")
  - title: A blank line and a custom separator
    code: |
      print("A")
      print()
      print("B", "C", "D", sep="-")
exercise:
  prompt: |
    Write a program that prints exactly these three lines:

    ```
    Hello, BSIT!
    Python is fun.
    Let's start coding.
    ```
  starter_code: |
    # Print the three lines here

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: The three lines
      stdin: ""
      expected_output: |
        Hello, BSIT!
        Python is fun.
        Let's start coding.
      is_hidden: false
      match_mode: trim
    - name: Nothing else is printed
      stdin: ""
      expected_output: |
        Hello, BSIT!
        Python is fun.
        Let's start coding.
      is_hidden: false
      match_mode: exact
    - name: Exact spelling (hidden)
      stdin: ""
      expected_output: "Hello, BSIT!\nPython is fun.\nLet's start coding.\n"
      is_hidden: true
      match_mode: exact
    - name: Line order (hidden)
      stdin: ""
      expected_output: |
        Hello, BSIT!
        Python is fun.
        Let's start coding.
      is_hidden: true
      match_mode: trim
  reference_solution: |
    print("Hello, BSIT!")
    print("Python is fun.")
    print("Let's start coding.")
---
## What `print()` does

`print()` shows something on the screen. Whatever you put between the parentheses is printed, and the cursor moves to the next line afterwards.

```python
print("Hello, world!")
```

Text must be written between quotes: `"Hello"` or `'Hello'`. Both work; just use the same kind at the start and the end.

## Printing more than one thing

Separate the things with commas. Python puts a space between them:

```python
print("The answer is", 42)
```

prints `The answer is 42`.

## Useful details

- `print()` with nothing inside prints an empty line.
- `sep=` changes what goes between the items: `print("A", "B", sep="-")` prints `A-B`.
- `end=` changes what comes after the line. The default is a line break; `print("Hi", end="")` stays on the same line.

## Common mistakes

- Forgetting the quotes: `print(Hello)` is an error, because Python looks for a *variable* called Hello.
- Mixing quote types: `print("Hello')` is an error.
- `Print` with a capital P does not exist. Python is case-sensitive.
