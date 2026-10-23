---
title: Parameters and return values
order: 18
summary: Pass values in, get a result back.
examples:
  - title: return gives a result back
    code: |
      def square(n):
          return n * n

      result = square(4)
      print(result)
      print(square(5) + square(6))
  - title: Several parameters, several results
    code: |
      def divide(a, b):
          return a // b, a % b

      quotient, remainder = divide(17, 5)
      print(quotient, remainder)
  - title: Default values
    code: |
      def power(base, exponent=2):
          return base ** exponent

      print(power(3))
      print(power(2, 10))
exercise:
  prompt: |
    Write two functions:

    - `area(width, height)` returns the area of a rectangle,
    - `perimeter(width, height)` returns its perimeter (`2 * (width + height)`).

    The program reads the width and the height and prints:

    ```
    Area: 12
    Perimeter: 14
    ```

    for `3` and `4`. The functions must **return** the values, not print them.
  starter_code: |
    # Define area(width, height) and perimeter(width, height) here


    width = int(input("Width: "))
    height = int(input("Height: "))
    print("Area:", area(width, height))
    print("Perimeter:", perimeter(width, height))
  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: 3 by 4
      stdin: "3\n4\n"
      expected_output: |
        Area: 12
        Perimeter: 14
      is_hidden: false
      match_mode: trim
    - name: A square
      stdin: "5\n5\n"
      expected_output: |
        Area: 25
        Perimeter: 20
      is_hidden: false
      match_mode: trim
    - name: One side is 1 (hidden)
      stdin: "1\n9\n"
      expected_output: |
        Area: 9
        Perimeter: 20
      is_hidden: true
      match_mode: trim
    - name: Nothing printed inside the functions (hidden)
      stdin: "10\n20\n"
      expected_output: "Area: 200\nPerimeter: 60\n"
      is_hidden: true
      match_mode: exact
  reference_solution: |
    def area(width, height):
        return width * height


    def perimeter(width, height):
        return 2 * (width + height)


    width = int(input("Width: "))
    height = int(input("Height: "))
    print("Area:", area(width, height))
    print("Perimeter:", perimeter(width, height))
---
## return

`return` sends a value back to the place where the function was called, and ends the function:

```python
def square(n):
    return n * n

x = square(4)      # x is 16
```

A function that only prints cannot be used in a calculation; a function that returns can:

```python
print(square(3) + square(4))   # 25
```

## print or return?

- **print** shows something to the user. The value is gone afterwards.
- **return** gives the value to the code that called the function, which can store it, print it, or pass it on.

Most functions should `return`; printing is done by the code that uses them.

## Returning more than one value

`return a, b` returns a tuple. Unpack it when you call the function:

```python
quotient, remainder = divide(17, 5)
```

## Default values

A parameter with `= value` is optional:

```python
def power(base, exponent=2):
    return base ** exponent

power(3)       # 9
power(2, 10)   # 1024
```

## No return means None

A function without `return` gives back `None`. `print(say_hello())` prints the greeting and then `None`.
