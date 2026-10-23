---
title: Strings
order: 6
summary: "Working with text: joining, length, letters by position, and slices."
examples:
  - title: Joining and repeating
    code: |
      first = "Ana"
      last = "Reyes"
      print(first + " " + last)
      print("-" * 10)
  - title: Length and single letters
    code: |
      word = "Python"
      print(len(word))
      print(word[0])
      print(word[-1])
  - title: Slices
    code: |
      word = "Python"
      print(word[0:3])
      print(word[3:])
exercise:
  prompt: |
    The variable `word` holds a word. Print, one per line:

    1. how many letters it has,
    2. its first letter,
    3. its last letter,
    4. the word written backwards (use the slice `word[::-1]`).

    For `word = "Kidapawan"` the output is:

    ```
    9
    K
    n
    nawapadiK
    ```
  starter_code: |
    word = "Kidapawan"

    # 1. length
    # 2. first letter
    # 3. last letter
    # 4. backwards

  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: Kidapawan
      stdin: ""
      expected_output: |
        9
        K
        n
        nawapadiK
      is_hidden: false
      match_mode: trim
    - name: One value per line
      stdin: ""
      expected_output: "9\nK\nn\nnawapadiK\n"
      is_hidden: false
      match_mode: exact
    - name: Nothing extra (hidden)
      stdin: ""
      expected_output: "9\nK\nn\nnawapadiK\n"
      is_hidden: true
      match_mode: exact
    - name: Order of the lines (hidden)
      stdin: ""
      expected_output: |
        9
        K
        n
        nawapadiK
      is_hidden: true
      match_mode: trim
  reference_solution: |
    word = "Kidapawan"

    print(len(word))
    print(word[0])
    print(word[-1])
    print(word[::-1])
---
## Joining text

`+` joins strings; `*` repeats them:

```python
print("Good " + "morning")   # Good morning
print("ab" * 3)              # ababab
```

Only text joins with text. To put a number into a sentence, convert it first: `"Age: " + str(19)`. (Lesson 23 shows a nicer way, f-strings.)

## Length and positions

`len(text)` counts the characters, including spaces. Each character has a position, starting at **0**:

```
 P  y  t  h  o  n
 0  1  2  3  4  5
-6 -5 -4 -3 -2 -1
```

`word[0]` is `P`, `word[5]` is `n`, and `word[-1]` is also `n` (negative numbers count from the end).

## Slices

`word[start:end]` gives the characters from `start` up to, but **not including**, `end`:

```python
word = "Python"
print(word[0:3])   # Pyt
print(word[2:])    # thon   (to the end)
print(word[:2])    # Py     (from the start)
print(word[::-1])  # nohtyP (step -1: backwards)
```

## Strings do not change

You cannot do `word[0] = "J"`. Instead make a new string: `word = "J" + word[1:]`.
