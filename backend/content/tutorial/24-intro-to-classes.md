---
title: Introduction to classes
order: 24
summary: Describe a kind of thing once, then make as many of them as you need.
examples:
  - title: A class with data and a method
    code: |
      class Student:
          def __init__(self, name, course):
              self.name = name
              self.course = course

          def describe(self):
              return f"{self.name} ({self.course})"

      ana = Student("Ana", "BSIT")
      ben = Student("Ben", "BSCS")
      print(ana.describe())
      print(ben.describe())
  - title: Methods that change the object
    code: |
      class Counter:
          def __init__(self):
              self.value = 0

          def increment(self):
              self.value += 1

      c = Counter()
      c.increment()
      c.increment()
      print(c.value)
  - title: Objects in a list
    code: |
      class Item:
          def __init__(self, name, price):
              self.name = name
              self.price = price

      cart = [Item("pen", 12), Item("notebook", 45)]
      total = 0
      for item in cart:
          total += item.price
      print("Total:", total)
exercise:
  prompt: |
    Write a class `BankAccount` with:

    - `__init__(self, owner, balance)` storing both values,
    - `deposit(self, amount)` adding to the balance,
    - `withdraw(self, amount)` subtracting it, but only if there is enough money; otherwise it prints
      `Insufficient funds` and changes nothing,
    - `summary(self)` returning `<owner>: <balance>` (for example `Ana: 150`).

    The program below reads an owner, a starting balance, a deposit and a withdrawal, and uses the
    class. Do not change it; add the class above it. For `Ana`, `100`, `50`, `30`:

    ```
    Ana: 120
    ```
  starter_code: |
    # Define the BankAccount class here


    owner = input("Owner: ")
    account = BankAccount(owner, int(input("Balance: ")))
    account.deposit(int(input("Deposit: ")))
    account.withdraw(int(input("Withdraw: ")))
    print(account.summary())
  entry: main.py
  ignore_input_prompts: true
  tests:
    - name: Ana 100 50 30
      stdin: "Ana\n100\n50\n30\n"
      expected_output: "Ana: 120"
      is_hidden: false
      match_mode: trim
    - name: Not enough money
      stdin: "Ben\n20\n0\n50\n"
      expected_output: |
        Insufficient funds
        Ben: 20
      is_hidden: false
      match_mode: trim
    - name: Withdraw everything (hidden)
      stdin: "Carl\n10\n5\n15\n"
      expected_output: "Carl: 0"
      is_hidden: true
      match_mode: trim
    - name: Withdraw one more than the balance (hidden)
      stdin: "Dina\n10\n5\n16\n"
      expected_output: |
        Insufficient funds
        Dina: 15
      is_hidden: true
      match_mode: trim
  reference_solution: |
    class BankAccount:
        def __init__(self, owner, balance):
            self.owner = owner
            self.balance = balance

        def deposit(self, amount):
            self.balance += amount

        def withdraw(self, amount):
            if amount > self.balance:
                print("Insufficient funds")
            else:
                self.balance -= amount

        def summary(self):
            return f"{self.owner}: {self.balance}"


    owner = input("Owner: ")
    account = BankAccount(owner, int(input("Balance: ")))
    account.deposit(int(input("Deposit: ")))
    account.withdraw(int(input("Withdraw: ")))
    print(account.summary())
---
## Why classes

A list can hold a student's name, a dictionary can hold their details, but neither knows what a student *does*. A **class** describes a kind of thing: the data it holds and the actions it can perform. Each thing made from the class is an **object**.

```python
class Student:
    def __init__(self, name, course):
        self.name = name
        self.course = course

    def describe(self):
        return f"{self.name} ({self.course})"
```

## `__init__` and `self`

`__init__` runs when an object is created, and it stores the starting values on the object. `self` is the object itself; `self.name = name` saves the parameter as an **attribute** of this particular object.

Every method takes `self` as its first parameter, but you do not pass it yourself:

```python
ana = Student("Ana", "BSIT")    # calls __init__ with self = the new object
print(ana.describe())           # self is ana
print(ana.name)                 # attributes are reached with a dot
```

## Each object is separate

`ana` and `ben` are two objects from the same class. Changing `ana.course` does not touch `ben`. Methods that change attributes (`self.balance += amount`) change only the object they were called on.

## Vocabulary

| Word | Meaning |
|---|---|
| class | the description (the "blueprint") |
| object, instance | one thing made from a class |
| attribute | a variable stored on an object (`self.name`) |
| method | a function defined inside a class |
| `__init__` | the method that sets up a new object |

Python's `str`, `list` and `dict` are classes too; `"abc".upper()` calls a method on a string object.
