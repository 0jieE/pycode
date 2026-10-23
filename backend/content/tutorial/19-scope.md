---
title: Scope
order: 19
summary: Where a variable can be seen, and why functions should return instead of changing things outside.
examples:
  - title: A local variable lives inside its function
    code: |
      def compute():
          result = 42
          print("inside:", result)

      compute()
      # print(result)   would be a NameError: result only exists inside compute()
  - title: Reading a global variable is fine
    code: |
      tax_rate = 0.12

      def with_tax(price):
          return price * (1 + tax_rate)

      print(with_tax(100))
  - title: Assigning makes a NEW local variable
    code: |
      total = 0

      def add(amount):
          total = amount        # a new local total, not the global one

      add(10)
      print(total)              # still 0
exercise:
  prompt: |
    The program should add two amounts to `total` and print `Total: 30` for the inputs `10` and `20`,
    but it prints `Total: 0`: `add_to_total` creates a **local** `total` instead of changing the
    global one.

    Fix it the recommended way: make the function **return** the new total and assign the result
    where the function is called. Do not use `global`.
  starter_code: |
    total = 0


    def add_to_total(amount):
        total = total + amount


    first = int(input("First amount: "))
    second = int(input("Second amount: "))
    add_to_total(first)
    add_to_total(second)
    print("Total:", total)
  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: 10 and 20
      stdin: "10\n20\n"
      expected_output: "Total: 30"
      is_hidden: false
      match_mode: trim
    - name: 5 and 0
      stdin: "5\n0\n"
      expected_output: "Total: 5"
      is_hidden: false
      match_mode: trim
    - name: Negative amount (hidden)
      stdin: "100\n-40\n"
      expected_output: "Total: 60"
      is_hidden: true
      match_mode: trim
    - name: Both zero (hidden)
      stdin: "0\n0\n"
      expected_output: "Total: 0"
      is_hidden: true
      match_mode: trim
  reference_solution: |
    total = 0


    def add_to_total(total, amount):
        return total + amount


    first = int(input("First amount: "))
    second = int(input("Second amount: "))
    total = add_to_total(total, first)
    total = add_to_total(total, second)
    print("Total:", total)
---
## Local and global

A variable created **inside** a function is *local*: it exists only while that function runs, and other code cannot see it. A variable created at the top level of the file is *global*: every function can read it.

```python
tax_rate = 0.12          # global

def with_tax(price):     # price is local
    amount = price * tax_rate   # amount is local; tax_rate is read from outside
    return amount
```

## The trap: assigning to a global name

Reading a global inside a function works. **Assigning** to the same name creates a new local variable instead:

```python
total = 0

def add(amount):
    total = total + amount    # UnboundLocalError: total is local here, and has no value yet

add(10)
```

Python sees `total = ...` in the function and decides `total` is local for the whole function, so even the read on the right side fails.

## The fix: return the value

Give the function what it needs as parameters and return the result; let the caller store it:

```python
def add(total, amount):
    return total + amount

total = add(total, 10)
```

This keeps functions independent and easy to test. Python also has a `global` keyword that lets a function change a global variable, but it makes programs hard to follow and is best avoided.

## Same name, different variables

A parameter or local called `total` inside a function is a different variable from a global `total`. That is normal and safe, as long as you remember the function cannot change the outer one.
