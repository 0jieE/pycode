---
title: Comments
order: 2
summary: Notes in your code that Python ignores.
examples:
  - title: A comment on its own line
    code: |
      # This line is a comment. Python skips it.
      print("Comments explain the code")
  - title: A comment after code
    code: |
      total = 5 + 3   # add the two numbers
      print(total)
  - title: Turning a line off
    code: |
      print("This runs")
      # print("This does not run")
exercise:
  prompt: |
    The program below has a bug: one of the lines that should be a comment is missing its `#`,
    so Python tries to run it.

    Fix the program so that it runs without errors and prints only:

    ```
    Start
    End
    ```

    Keep the explanations as comments; do not delete them.
  starter_code: |
    # This program prints a start and an end message
    print("Start")
    The middle part is not finished yet
    # print("Middle")
    print("End")
  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: Prints Start and End
      stdin: ""
      expected_output: |
        Start
        End
      is_hidden: false
      match_mode: trim
    - name: No error, nothing extra
      stdin: ""
      expected_output: "Start\nEnd\n"
      is_hidden: false
      match_mode: exact
    - name: Middle stays off (hidden)
      stdin: ""
      expected_output: |
        Start
        End
      is_hidden: true
      match_mode: exact
    - name: Exactly two lines (hidden)
      stdin: ""
      expected_output: "Start\nEnd"
      is_hidden: true
      match_mode: trim
  reference_solution: |
    # This program prints a start and an end message
    print("Start")
    # The middle part is not finished yet
    # print("Middle")
    print("End")
---
## What a comment is

A comment starts with `#`. Python ignores everything from the `#` to the end of the line. Comments are for people: they explain *why* the code does something.

```python
# Compute the total price including tax
total = price * 1.12
```

## Where comments go

- On their own line, above the code they explain.
- At the end of a line, after the code: `x = 10  # the number of students`.

## Turning code off

Putting `#` in front of a line is a quick way to stop it from running while you test something. This is called *commenting out* a line.

## Multi-line notes

Python has no special multi-line comment. Either start every line with `#`, or use a string on its own:

```python
"""
This text is a string that is not used anywhere,
so it works like a comment. You will see it again in functions.
"""
```

## Good habits

- Explain the *reason*, not the obvious: `x = x + 1  # add one to x` says nothing new.
- Keep comments up to date when the code changes. A wrong comment is worse than none.
