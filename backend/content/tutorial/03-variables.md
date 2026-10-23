---
title: Variables
order: 3
summary: Give a value a name so you can use it again.
examples:
  - title: Storing and using a value
    code: |
      name = "Maria"
      print("Hello,", name)
      print("Welcome,", name)
  - title: A variable can change
    code: |
      score = 10
      print(score)
      score = score + 5
      print(score)
  - title: Several variables
    code: |
      width = 4
      height = 3
      area = width * height
      print("Area:", area)
exercise:
  prompt: |
    Store your details in three variables, `name`, `course` and `year`, then print them in this form
    (one per line):

    ```
    Name: Juan Dela Cruz
    Course: BSIT
    Year: 1
    ```

    Use the values `Juan Dela Cruz`, `BSIT` and `1`. Print each line with `print()` and a comma,
    so that there is exactly one space after the colon.
  starter_code: |
    name = "Juan Dela Cruz"
    course = ""
    year = 0

    # Print the three lines using the variables

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: The three lines
      stdin: ""
      expected_output: |
        Name: Juan Dela Cruz
        Course: BSIT
        Year: 1
      is_hidden: false
      match_mode: trim
    - name: Spacing after the colons
      stdin: ""
      expected_output: "Name: Juan Dela Cruz\nCourse: BSIT\nYear: 1\n"
      is_hidden: false
      match_mode: exact
    - name: Nothing extra (hidden)
      stdin: ""
      expected_output: "Name: Juan Dela Cruz\nCourse: BSIT\nYear: 1\n"
      is_hidden: true
      match_mode: exact
    - name: Line order (hidden)
      stdin: ""
      expected_output: |
        Name: Juan Dela Cruz
        Course: BSIT
        Year: 1
      is_hidden: true
      match_mode: trim
  reference_solution: |
    name = "Juan Dela Cruz"
    course = "BSIT"
    year = 1

    print("Name:", name)
    print("Course:", course)
    print("Year:", year)
---
## What a variable is

A variable is a name that points to a value. You create one with `=`:

```python
age = 18
```

Read it as "age *becomes* 18", not "age equals 18". After this line, every time you write `age`, Python uses the value 18.

## Changing a variable

Assigning again replaces the old value:

```python
age = 18
age = age + 1   # now 19
```

The right side is computed first, then stored in the name on the left.

## Naming rules

- Letters, digits and underscores only: `total_price`, `student2`.
- Cannot start with a digit: `2nd_place` is an error.
- Case matters: `score` and `Score` are different variables.
- Cannot be a Python keyword such as `print`, `if` or `for`.

Use names that say what the value is. `n` means nothing; `number_of_students` does.

## Common mistakes

- Using a variable before giving it a value: `NameError: name 'total' is not defined`.
- Typing the name differently in two places (`studentName` vs `student_name`).
