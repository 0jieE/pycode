---
title: Functions
order: 17
summary: Give a block of code a name and run it whenever you need it.
examples:
  - title: Defining and calling
    code: |
      def say_hello():
          print("Hello!")
          print("Welcome to the lab.")

      say_hello()
      say_hello()
  - title: A function with a parameter
    code: |
      def greet(name):
          print("Hello,", name)

      greet("Ana")
      greet("Ben")
  - title: Functions keep code organised
    code: |
      def print_line():
          print("-" * 20)

      print_line()
      print("Report")
      print_line()
exercise:
  prompt: |
    Write a function `greet(name)` that prints `Hello, <name>!` (with the exclamation mark and no
    space before it). The program already reads two names and calls `greet` for each: do not change
    those lines, only add the function above them.

    For the inputs `Ana` and `Ben` the output is:

    ```
    Hello, Ana!
    Hello, Ben!
    ```
  starter_code: |
    # Define greet(name) here


    first = input("First name: ")
    second = input("Second name: ")
    greet(first)
    greet(second)
  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: Ana and Ben
      stdin: "Ana\nBen\n"
      expected_output: |
        Hello, Ana!
        Hello, Ben!
      is_hidden: false
      match_mode: trim
    - name: Names with spaces
      stdin: "Juan Dela Cruz\nMaria Clara\n"
      expected_output: |
        Hello, Juan Dela Cruz!
        Hello, Maria Clara!
      is_hidden: false
      match_mode: trim
    - name: Exact punctuation (hidden)
      stdin: "x\ny\n"
      expected_output: "Hello, x!\nHello, y!\n"
      is_hidden: true
      match_mode: exact
    - name: Same name twice (hidden)
      stdin: "Lee\nLee\n"
      expected_output: |
        Hello, Lee!
        Hello, Lee!
      is_hidden: true
      match_mode: trim
  reference_solution: |
    def greet(name):
        print("Hello, " + name + "!")


    first = input("First name: ")
    second = input("Second name: ")
    greet(first)
    greet(second)
---
## Defining a function

```python
def say_hello():
    print("Hello!")
```

`def`, the name, parentheses, a colon, then an indented block. Defining a function does **not** run it. It runs when you **call** it:

```python
say_hello()
```

You can call it as many times as you like. That is the point: write the code once, use it everywhere.

## Parameters

A parameter is a variable that receives a value when the function is called:

```python
def greet(name):
    print("Hello,", name)

greet("Ana")     # name is "Ana" inside the function
```

The value you pass (`"Ana"`) is called an *argument*. A function can have several parameters, separated by commas.

## Define before you call

Python reads the file from top to bottom. The `def` must come before the first call, or you get `NameError`.

## Docstrings

A string right after the `def` line describes the function. Tools and other programmers read it:

```python
def greet(name):
    """Print a greeting for name."""
    print("Hello,", name)
```
