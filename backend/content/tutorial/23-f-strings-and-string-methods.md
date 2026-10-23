---
title: f-strings and string methods
order: 23
summary: Build text from values, and the most useful things strings can do.
examples:
  - title: f-strings
    code: |
      name = "Ana"
      score = 95.5
      print(f"{name} scored {score} points")
      print(f"Rounded: {score:.0f}")
      print(f"{name:>10}|")
  - title: Changing case and trimming
    code: |
      text = "  Hello World  "
      print(text.strip())
      print(text.upper())
      print(text.lower())
      print(text.strip().title())
  - title: Finding, replacing, splitting
    code: |
      sentence = "the quick brown fox"
      print(sentence.count("o"))
      print(sentence.replace("quick", "slow"))
      print(sentence.split())
      print("-".join(["a", "b", "c"]))
      print(sentence.startswith("the"))
exercise:
  prompt: |
    Read a full name (which may have extra spaces around it) and a grade (a decimal number). Print:

    1. the name trimmed and in **title case**, after `Name: `,
    2. the grade with exactly **two decimals**, after `Grade: `,
    3. the name's initials (the first letter of each word, uppercase, no spaces), after `Initials: `.

    For `  juan dela cruz  ` and `89.456`:

    ```
    Name: Juan Dela Cruz
    Grade: 89.46
    Initials: JDC
    ```

    Use an f-string for the grade (`{grade:.2f}`).
  starter_code: |
    name = input("Name: ")
    grade = float(input("Grade: "))

    # Print Name, Grade and Initials

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: juan dela cruz
      stdin: "  juan dela cruz  \n89.456\n"
      expected_output: |
        Name: Juan Dela Cruz
        Grade: 89.46
        Initials: JDC
      is_hidden: false
      match_mode: trim
    - name: Already clean
      stdin: "Ana Lim\n100\n"
      expected_output: |
        Name: Ana Lim
        Grade: 100.00
        Initials: AL
      is_hidden: false
      match_mode: trim
    - name: One word, rounding up (hidden)
      stdin: "MADONNA\n74.995\n"
      expected_output: |
        Name: Madonna
        Grade: 75.00
        Initials: M
      is_hidden: true
      match_mode: trim
    - name: Mixed case and tabs (hidden)
      stdin: "\tmARIA cLARA\n60.5\n"
      expected_output: |
        Name: Maria Clara
        Grade: 60.50
        Initials: MC
      is_hidden: true
      match_mode: trim
  reference_solution: |
    name = input("Name: ")
    grade = float(input("Grade: "))

    clean = name.strip().title()
    initials = ""
    for word in clean.split():
        initials += word[0]

    print(f"Name: {clean}")
    print(f"Grade: {grade:.2f}")
    print(f"Initials: {initials}")
---
## f-strings

An f-string is a string with an `f` before the quotes. Anything inside `{}` is replaced by its value:

```python
name = "Ana"
age = 19
print(f"{name} is {age} years old")
```

This is the clearest way to mix text and values. No `+`, no `str()`.

## Formatting inside the braces

After a colon you can say how the value should look:

| Code | Result | Meaning |
|---|---|---|
| `f"{3.14159:.2f}"` | `3.14` | 2 decimals |
| `f"{7:03d}"` | `007` | at least 3 digits, zero-padded |
| `f"{'hi':>6}"` | `    hi` | right-aligned in 6 spaces |
| `f"{'hi':<6}\|"` | `hi    \|` | left-aligned |
| `f"{1234567:,}"` | `1,234,567` | thousands separators |

## String methods

Methods are called with a dot. They return a **new** string; the original does not change.

| Method | Does |
|---|---|
| `s.strip()` | remove spaces (and tabs, line breaks) at both ends |
| `s.upper()`, `s.lower()` | change case |
| `s.title()` | First Letter Of Each Word |
| `s.replace(old, new)` | replace every `old` |
| `s.split()` | list of words (split on spaces) |
| `s.split(",")` | split on a comma |
| `sep.join(list)` | the opposite of split |
| `s.find(x)` | position of `x`, or -1 |
| `s.count(x)` | how many times `x` appears |
| `s.startswith(x)`, `s.endswith(x)` | True or False |
| `s.isdigit()` | True if all characters are digits |

Methods can be chained: `name.strip().title()`.
