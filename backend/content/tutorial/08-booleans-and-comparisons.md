---
title: Booleans and comparisons
order: 8
summary: True and False, comparing values, and combining conditions with and, or, not.
examples:
  - title: Comparisons give True or False
    code: |
      print(5 > 3)
      print(5 == 3)
      print("a" != "b")
  - title: Combining conditions
    code: |
      age = 20
      print(age >= 18 and age < 60)
      print(age < 18 or age > 65)
      print(not age < 18)
  - title: Storing a boolean
    code: |
      temperature = 32
      is_hot = temperature > 30
      print("Hot:", is_hot)
exercise:
  prompt: |
    Read a person's age (a whole number) and print three lines:

    ```
    Adult: True
    Teen: False
    Senior: False
    ```

    - *Adult* means 18 or older.
    - *Teen* means from 13 to 19, both included.
    - *Senior* means 60 or older.

    Print the results of the comparisons directly; do not write `"True"` or `"False"` yourself.
  starter_code: |
    age = int(input("Age: "))

    # Print Adult, Teen and Senior

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: Age 25
      stdin: "25\n"
      expected_output: |
        Adult: True
        Teen: False
        Senior: False
      is_hidden: false
      match_mode: trim
    - name: Age 15
      stdin: "15\n"
      expected_output: |
        Adult: False
        Teen: True
        Senior: False
      is_hidden: false
      match_mode: trim
    - name: Age 18 is an adult and a teen (hidden)
      stdin: "18\n"
      expected_output: |
        Adult: True
        Teen: True
        Senior: False
      is_hidden: true
      match_mode: trim
    - name: Age 60 is a senior (hidden)
      stdin: "60\n"
      expected_output: |
        Adult: True
        Teen: False
        Senior: True
      is_hidden: true
      match_mode: trim
  reference_solution: |
    age = int(input("Age: "))

    print("Adult:", age >= 18)
    print("Teen:", age >= 13 and age <= 19)
    print("Senior:", age >= 60)
---
## Two values: True and False

A **boolean** is either `True` or `False`. Comparisons produce booleans:

| Comparison | Meaning |
|---|---|
| `a == b` | equal (two `=` signs!) |
| `a != b` | not equal |
| `a < b`, `a > b` | less than, greater than |
| `a <= b`, `a >= b` | less or equal, greater or equal |

```python
print(10 == 10)   # True
print(10 == "10") # False: a number and a text are never equal
```

`=` assigns a value; `==` compares. Mixing them up is one of the most common mistakes.

## Combining conditions

| Operator | True when |
|---|---|
| `a and b` | both are true |
| `a or b` | at least one is true |
| `not a` | a is false |

```python
age = 15
print(age >= 13 and age <= 19)   # True: a teen
```

Python also lets you write a range as `13 <= age <= 19`.

## Booleans in variables

A condition can be stored and used later, which makes code easier to read:

```python
is_weekend = day == "Saturday" or day == "Sunday"
```
