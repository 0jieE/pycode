---
title: Reading and writing files
order: 22
summary: Save data to a file and read it back.
examples:
  - title: Writing a file
    code: |
      with open("notes.txt", "w") as f:
          f.write("first line\n")
          f.write("second line\n")
      print("saved")
  - title: Reading the whole file
    code: |
      with open("notes.txt", "w") as f:
          f.write("hello\nworld\n")

      with open("notes.txt") as f:
          content = f.read()
      print(content)
  - title: Reading line by line
    code: |
      with open("scores.txt", "w") as f:
          f.write("80\n95\n70\n")

      total = 0
      with open("scores.txt") as f:
          for line in f:
              total += int(line)
      print("Total:", total)
exercise:
  prompt: |
    Read three names, one per line, and write them to a file called `names.txt`, one name per line.
    Then open the file again, read it, and print how many lines it has and the names in
    **reverse** order:

    ```
    Lines: 3
    Carl
    Ben
    Ana
    ```

    for the inputs `Ana`, `Ben`, `Carl`. The program must really write and read the file.
  starter_code: |
    # Read three names

    # Write them to names.txt, one per line

    # Read names.txt back, print the line count and the names reversed

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: Ana, Ben, Carl
      stdin: "Ana\nBen\nCarl\n"
      expected_output: |
        Lines: 3
        Carl
        Ben
        Ana
      is_hidden: false
      match_mode: trim
    - name: Names with spaces
      stdin: "Juan Cruz\nMaria Clara\nJose Rizal\n"
      expected_output: |
        Lines: 3
        Jose Rizal
        Maria Clara
        Juan Cruz
      is_hidden: false
      match_mode: trim
    - name: Same name three times (hidden)
      stdin: "x\nx\nx\n"
      expected_output: |
        Lines: 3
        x
        x
        x
      is_hidden: true
      match_mode: trim
    - name: Numbers as names (hidden)
      stdin: "1\n2\n3\n"
      expected_output: |
        Lines: 3
        3
        2
        1
      is_hidden: true
      match_mode: trim
  reference_solution: |
    names = []
    for i in range(3):
        names.append(input("Name: "))

    with open("names.txt", "w") as f:
        for name in names:
            f.write(name + "\n")

    with open("names.txt") as f:
        lines = f.read().splitlines()

    print("Lines:", len(lines))
    for name in reversed(lines):
        print(name)
---
## Opening a file

`open(name, mode)` opens a file in the program's working folder:

| Mode | Meaning |
|---|---|
| `"r"` | read (the default) |
| `"w"` | write: creates the file, or **replaces** its content |
| `"a"` | append: adds to the end |

Always use `with`. It closes the file for you when the block ends, even if an error happens:

```python
with open("notes.txt", "w") as f:
    f.write("hello\n")
```

`write()` does not add a line break; put `"\n"` where you want one.

## Reading

```python
with open("notes.txt") as f:
    content = f.read()          # everything, as one string
```

Other ways:

- `f.readlines()`: a list of lines, each still ending with `"\n"`.
- `f.read().splitlines()`: a list of lines without the `"\n"`.
- `for line in f:` goes through the lines one by one, which is best for big files.

Lines read from a file are text, so convert numbers with `int()` or `float()`.

## Missing files

Opening a file for reading that does not exist raises `FileNotFoundError`. Catch it with `try`/`except` (lesson 21) if the file may be missing.

## In the tutorial sandbox

Files you write go to the program's own temporary folder, which is empty at the start of every run and deleted afterwards.
