"""The courses of the demo, each with three lab activities. Every activity has starter files, two sample and two hidden
tests (sample 2 points, hidden 3: 10 points in all), and three versions of a student's work: "correct", "partial"
(a typical mistake that fails some tests) and "wrong". A version maps a file path (relative to the activity folder)
to its content and replaces that starter file. demo/build.py grades every version in the real sandbox first, so the
scores in the demo are the engine's real results."""


def t(name: str, stdin: str, expected: str, hidden: bool, mode: str = "trim") -> dict:
    return {"name": name, "stdin": stdin, "expected_output": expected, "is_hidden": hidden,
            "points": 3 if hidden else 2, "match_mode": mode}


COURSES = [
    # ======================================================================================== first year
    {
        "code": "CC 101", "name": "Computer Programming 1", "year": 1,
        "activities": [
            {
                "title": "Lab 1 - Hello and Input",
                "instructions": "Ask for the user's **name** and **age**, then print a greeting and their age next year:\n\n"
                                "```\nHello, Ana!\nNext year you will be 19.\n```",
                "starter": {"main.py": "# Read the name and the age, then print the two lines\n"},
                "tests": [t("Ana, 18", "Ana\n18\n", "Hello, Ana!\nNext year you will be 19.", False),
                          t("Ben, 20", "Ben\n20\n", "Hello, Ben!\nNext year you will be 21.", False),
                          t("Two-word name", "Juan Dela Cruz\n17\n", "Hello, Juan Dela Cruz!\nNext year you will be 18.", True),
                          t("Age 0", "Baby\n0\n", "Hello, Baby!\nNext year you will be 1.", True)],
                "versions": {
                    "correct": {"main.py": 'name = input("Name: ")\nage = int(input("Age: "))\n'
                                           'print(f"Hello, {name}!")\nprint(f"Next year you will be {age + 1}.")\n'},
                    "partial": {"main.py": 'name = input("Name: ").split()[0]\nage = int(input("Age: "))\n'
                                           'print(f"Hello, {name}!")\nprint(f"Next year you will be {age + 1}.")\n'},
                    "wrong": {"main.py": 'name = input("Name: ")\nage = input("Age: ")\n'
                                         'print("Hello, " + name + "!")\nprint("Next year you will be " + age + 1 + ".")\n'},
                },
            },
            {
                "title": "Lab 2 - Grade Calculator",
                "instructions": "Read three quiz scores (0-100). Print their average with **two decimals** and the remark:\n\n"
                                "| Average | Remark |\n|---|---|\n| 90 and up | Excellent |\n| 80 to below 90 | Very Good |\n"
                                "| 75 to below 80 | Passed |\n| below 75 | Failed |\n\n```\nAverage: 85.33\nRemark: Very Good\n```",
                "starter": {"main.py": "# Read three scores, compute the average, print the average and the remark\n"},
                "tests": [t("80 85 91", "80\n85\n91\n", "Average: 85.33\nRemark: Very Good", False),
                          t("Failing", "60\n70\n72\n", "Average: 67.33\nRemark: Failed", False),
                          t("Exactly 90", "90\n90\n90\n", "Average: 90.00\nRemark: Excellent", True),
                          t("Exactly 75", "75\n75\n75\n", "Average: 75.00\nRemark: Passed", True)],
                "versions": {
                    "correct": {"main.py": 'scores = [float(input(f"Quiz {i}: ")) for i in range(1, 4)]\n'
                                           'average = sum(scores) / 3\n'
                                           'if average >= 90:\n    remark = "Excellent"\nelif average >= 80:\n    remark = "Very Good"\n'
                                           'elif average >= 75:\n    remark = "Passed"\nelse:\n    remark = "Failed"\n'
                                           'print(f"Average: {average:.2f}")\nprint(f"Remark: {remark}")\n'},
                    "partial": {"main.py": 'a = float(input())\nb = float(input())\nc = float(input())\naverage = (a + b + c) / 3\n'
                                           'if average > 90:\n    remark = "Excellent"\nelif average > 80:\n    remark = "Very Good"\n'
                                           'elif average > 75:\n    remark = "Passed"\nelse:\n    remark = "Failed"\n'
                                           'print(f"Average: {average:.2f}")\nprint(f"Remark: {remark}")\n'},
                    "wrong": {"main.py": 'a = int(input())\nb = int(input())\nc = int(input())\naverage = a + b + c / 3\n'
                                         'print("Average:", average)\nprint("Remark: Passed")\n'},
                },
            },
            {
                "title": "Lab 3 - Number Patterns",
                "instructions": "Read a whole number `n` and print a right triangle of `*` with `n` rows. For `n = 3`:\n\n"
                                "```\n*\n**\n***\n```",
                "starter": {"main.py": "n = int(input(\"Rows: \"))\n\n# Print the triangle with a loop\n"},
                "tests": [t("3 rows", "3\n", "*\n**\n***", False),
                          t("1 row", "1\n", "*", False),
                          t("5 rows", "5\n", "*\n**\n***\n****\n*****", True),
                          t("0 rows", "0\n", "", True, "exact")],
                "versions": {
                    "correct": {"main.py": 'n = int(input("Rows: "))\n\nfor i in range(1, n + 1):\n    print("*" * i)\n'},
                    "partial": {"main.py": 'n = int(input("Rows: "))\n\nfor i in range(1, n):\n    print("*" * i)\n'},
                    "wrong": {"main.py": 'n = int(input("Rows: "))\n\nfor i in range(n):\n    print("*" * n)\n'},
                },
            },
        ],
    },
    {
        "code": "IT 101", "name": "Introduction to Computing", "year": 1,
        "activities": [
            {
                "title": "Lab 1 - Unit Converter",
                "instructions": "Read a distance in **kilometres** (a decimal number) and print it in miles with two decimals "
                                "(1 km = 0.621371 mi):\n\n```\n10.0 km = 6.21 mi\n```",
                "starter": {"main.py": "# Read kilometres, convert to miles, print\n"},
                "tests": [t("10 km", "10\n", "10.0 km = 6.21 mi", False),
                          t("42.195 km", "42.195\n", "42.195 km = 26.22 mi", False),
                          t("0 km", "0\n", "0.0 km = 0.00 mi", True),
                          t("1 km", "1\n", "1.0 km = 0.62 mi", True)],
                "versions": {
                    "correct": {"main.py": 'km = float(input("Kilometres: "))\nmiles = km * 0.621371\nprint(f"{km} km = {miles:.2f} mi")\n'},
                    "partial": {"main.py": 'km = float(input("Kilometres: "))\nmiles = km * 0.62\nprint(f"{km} km = {miles:.2f} mi")\n'},
                    "wrong": {"main.py": 'km = input("Kilometres: ")\nprint(km, "km =", km, "mi")\n'},
                },
            },
            {
                "title": "Lab 2 - Even or Odd",
                "instructions": "Read a whole number and print whether it is even or odd, and whether it is positive, "
                                "negative or zero:\n\n```\n7 is odd\n7 is positive\n```",
                "starter": {"main.py": "number = int(input(\"Number: \"))\n\n# Print the two lines\n"},
                "tests": [t("7", "7\n", "7 is odd\n7 is positive", False),
                          t("-4", "-4\n", "-4 is even\n-4 is negative", False),
                          t("0", "0\n", "0 is even\n0 is zero", True),
                          t("-9", "-9\n", "-9 is odd\n-9 is negative", True)],
                "versions": {
                    "correct": {"main.py": 'number = int(input("Number: "))\n\n'
                                           'print(f"{number} is {\'even\' if number % 2 == 0 else \'odd\'}")\n'
                                           'if number > 0:\n    print(f"{number} is positive")\nelif number < 0:\n'
                                           '    print(f"{number} is negative")\nelse:\n    print(f"{number} is zero")\n'},
                    "partial": {"main.py": 'number = int(input("Number: "))\n\n'
                                           'print(f"{number} is {\'even\' if number % 2 == 0 else \'odd\'}")\n'
                                           'if number >= 0:\n    print(f"{number} is positive")\nelse:\n'
                                           '    print(f"{number} is negative")\n'},
                    "wrong": {"main.py": 'number = int(input("Number: "))\n\nif number / 2 == 0:\n    print("even")\nelse:\n    print("odd")\n'},
                },
            },
            {
                "title": "Lab 3 - Sum of Digits",
                "instructions": "Read a non-negative whole number and print the sum of its digits:\n\n```\nSum of digits: 15\n```\n\n"
                                "(for `12345`). Use a loop with `%` and `//`.",
                "starter": {"main.py": "n = int(input(\"Number: \"))\n\n# Add up the digits\n"},
                "tests": [t("12345", "12345\n", "Sum of digits: 15", False),
                          t("7", "7\n", "Sum of digits: 7", False),
                          t("0", "0\n", "Sum of digits: 0", True),
                          t("9999", "9999\n", "Sum of digits: 36", True)],
                "versions": {
                    "correct": {"main.py": 'n = int(input("Number: "))\n\ntotal = 0\nwhile n > 0:\n    total += n % 10\n    n //= 10\n'
                                           'print("Sum of digits:", total)\n'},
                    "partial": {"main.py": 'n = int(input("Number: "))\n\ntotal = 0\nwhile n > 9:\n    total += n % 10\n    n //= 10\n'
                                           'print("Sum of digits:", total)\n'},
                    "wrong": {"main.py": 'n = int(input("Number: "))\n\nprint("Sum of digits:", n % 10 + n // 10)\n'},
                },
            },
        ],
    },
    {
        "code": "IT 102", "name": "Problem Solving with Python", "year": 1,
        "activities": [
            {
                "title": "Lab 1 - Leap Year",
                "instructions": "Read a year and print `Leap year` or `Not a leap year`. A year is a leap year if it is "
                                "divisible by 4, except years divisible by 100, unless they are also divisible by 400.",
                "starter": {"main.py": "year = int(input(\"Year: \"))\n\n# Decide and print\n"},
                "tests": [t("2024", "2024\n", "Leap year", False),
                          t("2023", "2023\n", "Not a leap year", False),
                          t("1900", "1900\n", "Not a leap year", True),
                          t("2000", "2000\n", "Leap year", True)],
                "versions": {
                    "correct": {"main.py": 'year = int(input("Year: "))\n\n'
                                           'if (year % 4 == 0 and year % 100 != 0) or year % 400 == 0:\n    print("Leap year")\n'
                                           'else:\n    print("Not a leap year")\n'},
                    "partial": {"main.py": 'year = int(input("Year: "))\n\nif year % 4 == 0:\n    print("Leap year")\n'
                                           'else:\n    print("Not a leap year")\n'},
                    "wrong": {"main.py": 'year = int(input("Year: "))\n\nif year % 4:\n    print("Leap year")\nelse:\n'
                                         '    print("Not a leap year")\n'},
                },
            },
            {
                "title": "Lab 2 - FizzBuzz",
                "instructions": "Read `n` and print the numbers from 1 to `n`, one per line, but print `Fizz` for multiples "
                                "of 3, `Buzz` for multiples of 5 and `FizzBuzz` for multiples of both.",
                "starter": {"main.py": "n = int(input(\"n: \"))\n\n# FizzBuzz from 1 to n\n"},
                "tests": [t("5", "5\n", "1\n2\nFizz\n4\nBuzz", False),
                          t("1", "1\n", "1", False),
                          t("15", "15\n", "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz", True),
                          t("16", "16\n", "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz\n16", True)],
                "versions": {
                    "correct": {"main.py": 'n = int(input("n: "))\n\nfor i in range(1, n + 1):\n    if i % 15 == 0:\n'
                                           '        print("FizzBuzz")\n    elif i % 3 == 0:\n        print("Fizz")\n'
                                           '    elif i % 5 == 0:\n        print("Buzz")\n    else:\n        print(i)\n'},
                    "partial": {"main.py": 'n = int(input("n: "))\n\nfor i in range(1, n + 1):\n    if i % 3 == 0:\n'
                                           '        print("Fizz")\n    elif i % 5 == 0:\n        print("Buzz")\n'
                                           '    elif i % 15 == 0:\n        print("FizzBuzz")\n    else:\n        print(i)\n'},
                    "wrong": {"main.py": 'n = int(input("n: "))\n\nfor i in range(n):\n    print(i)\n'},
                },
            },
            {
                "title": "Lab 3 - Palindrome Checker",
                "instructions": "Read a word or phrase and print `Palindrome` if it reads the same backwards, ignoring "
                                "capital letters and spaces; otherwise `Not a palindrome`.",
                "starter": {"main.py": "text = input(\"Text: \")\n\n# Check and print\n"},
                "tests": [t("level", "level\n", "Palindrome", False),
                          t("python", "python\n", "Not a palindrome", False),
                          t("Capital letters", "Racecar\n", "Palindrome", True),
                          t("Spaces", "Never odd or even\n", "Palindrome", True)],
                "versions": {
                    "correct": {"main.py": 'text = input("Text: ")\n\ncleaned = text.replace(" ", "").lower()\n'
                                           'if cleaned == cleaned[::-1]:\n    print("Palindrome")\nelse:\n    print("Not a palindrome")\n'},
                    "partial": {"main.py": 'text = input("Text: ")\n\nif text == text[::-1]:\n    print("Palindrome")\nelse:\n'
                                           '    print("Not a palindrome")\n'},
                    "wrong": {"main.py": 'text = input("Text: ")\n\nprint("Palindrome")\n'},
                },
            },
        ],
    },
    # ======================================================================================= second year
    {
        "code": "CC 104", "name": "Data Structures and Algorithms", "year": 2,
        "activities": [
            {
                "title": "Lab 1 - Linear Search",
                "instructions": "The first line has numbers separated by spaces, the second a target. Implement "
                                "`linear_search(items, target)` in `search.py` (the index of the first match, or -1); "
                                "`main.py` is complete.",
                "starter": {"main.py": "from search import linear_search\n\nitems = [int(x) for x in input(\"Numbers: \").split()]\n"
                                       "target = int(input(\"Target: \"))\nprint(\"Index:\", linear_search(items, target))\n",
                            "search.py": "def linear_search(items, target):\n    # Return the index of the first item equal to target, or -1\n    pass\n"},
                "tests": [t("Found", "4 8 15 16\n15\n", "Index: 2", False),
                          t("Missing", "1 2 3\n9\n", "Index: -1", False),
                          t("First of two", "5 7 5\n5\n", "Index: 0", True),
                          t("Last item", "9 8 7 6\n6\n", "Index: 3", True)],
                "versions": {
                    "correct": {"search.py": "def linear_search(items, target):\n    for i in range(len(items)):\n"
                                             "        if items[i] == target:\n            return i\n    return -1\n"},
                    "partial": {"search.py": "def linear_search(items, target):\n    for i in range(len(items) - 1):\n"
                                             "        if items[i] == target:\n            return i\n    return -1\n"},
                    "wrong": {"search.py": "def linear_search(items, target):\n    for i in range(len(items)):\n"
                                           "        if items[i] == target:\n            return i\n        return -1\n"},
                },
            },
            {
                "title": "Lab 2 - Bubble Sort",
                "instructions": "Read numbers separated by spaces and print them in ascending order, separated by spaces. "
                                "Write the bubble sort yourself (do not use `sorted` or `.sort()`).",
                "starter": {"main.py": "numbers = [int(x) for x in input(\"Numbers: \").split()]\n\n# Bubble sort, then print\n"},
                "tests": [t("Unsorted", "5 2 9 1\n", "1 2 5 9", False),
                          t("Already sorted", "1 2 3\n", "1 2 3", False),
                          t("Duplicates and negatives", "3 -1 3 0 -1\n", "-1 -1 0 3 3", True),
                          t("Reversed", "9 7 5 3 1\n", "1 3 5 7 9", True)],
                "versions": {
                    "correct": {"main.py": 'numbers = [int(x) for x in input("Numbers: ").split()]\n\nn = len(numbers)\n'
                                           'for i in range(n - 1):\n    for j in range(n - 1 - i):\n'
                                           '        if numbers[j] > numbers[j + 1]:\n'
                                           '            numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\n'
                                           'print(" ".join(str(x) for x in numbers))\n'},
                    "partial": {"main.py": 'numbers = [int(x) for x in input("Numbers: ").split()]\n\nn = len(numbers)\n'
                                           'for j in range(n - 1):\n    if numbers[j] > numbers[j + 1]:\n'
                                           '        numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\n'
                                           'print(" ".join(str(x) for x in numbers))\n'},
                    "wrong": {"main.py": 'numbers = [int(x) for x in input("Numbers: ").split()]\n\nprint(numbers)\n'},
                },
            },
            {
                "title": "Lab 3 - Balanced Brackets",
                "instructions": "Read a line of brackets `()[]{}` (and maybe other characters) and print `Balanced` "
                                "if every bracket is closed in the right order, else `Not balanced`. Use a list as a stack.",
                "starter": {"main.py": "text = input(\"Text: \")\n\n# Use a stack\n"},
                "tests": [t("Nested", "{[()]}\n", "Balanced", False),
                          t("Wrong order", "([)]\n", "Not balanced", False),
                          t("Unclosed", "((\n", "Not balanced", True),
                          t("With other characters", "print(a[0] + {b: c})\n", "Balanced", True)],
                "versions": {
                    "correct": {"main.py": 'text = input("Text: ")\n\npairs = {")": "(", "]": "[", "}": "{"}\nstack = []\n'
                                           'ok = True\nfor ch in text:\n    if ch in "([{":\n        stack.append(ch)\n'
                                           '    elif ch in pairs:\n        if not stack or stack.pop() != pairs[ch]:\n'
                                           '            ok = False\n            break\n'
                                           'print("Balanced" if ok and not stack else "Not balanced")\n'},
                    "partial": {"main.py": 'text = input("Text: ")\n\npairs = {")": "(", "]": "[", "}": "{"}\nstack = []\n'
                                           'ok = True\nfor ch in text:\n    if ch in "([{":\n        stack.append(ch)\n'
                                           '    elif ch in pairs:\n        if not stack or stack.pop() != pairs[ch]:\n'
                                           '            ok = False\n            break\n'
                                           'print("Balanced" if ok else "Not balanced")\n'},
                    "wrong": {"main.py": 'text = input("Text: ")\n\nif text.count("(") == text.count(")"):\n    print("Balanced")\n'
                                         'else:\n    print("Not balanced")\n'},
                },
            },
        ],
    },
    {
        "code": "IT 201", "name": "Object-Oriented Programming", "year": 2,
        "activities": [
            {
                "title": "Lab 1 - Rectangle Class",
                "instructions": "Complete the `Rectangle` class in `shapes.py`: `area()` and `perimeter()`. "
                                "`main.py` reads the width and height and prints both; do not change it.",
                "starter": {"main.py": "from shapes import Rectangle\n\nr = Rectangle(float(input(\"Width: \")), float(input(\"Height: \")))\n"
                                       "print(f\"Area: {r.area():.1f}\")\nprint(f\"Perimeter: {r.perimeter():.1f}\")\n",
                            "shapes.py": "class Rectangle:\n    def __init__(self, width, height):\n        self.width = width\n"
                                         "        self.height = height\n\n    def area(self):\n        pass\n\n"
                                         "    def perimeter(self):\n        pass\n"},
                "tests": [t("3 x 4", "3\n4\n", "Area: 12.0\nPerimeter: 14.0", False),
                          t("Square", "5\n5\n", "Area: 25.0\nPerimeter: 20.0", False),
                          t("Decimals", "2.5\n4\n", "Area: 10.0\nPerimeter: 13.0", True),
                          t("Thin", "1\n10\n", "Area: 10.0\nPerimeter: 22.0", True)],
                "versions": {
                    "correct": {"shapes.py": "class Rectangle:\n    def __init__(self, width, height):\n        self.width = width\n"
                                             "        self.height = height\n\n    def area(self):\n        return self.width * self.height\n\n"
                                             "    def perimeter(self):\n        return 2 * (self.width + self.height)\n"},
                    "partial": {"shapes.py": "class Rectangle:\n    def __init__(self, width, height):\n        self.width = width\n"
                                             "        self.height = height\n\n    def area(self):\n        return self.width * self.height\n\n"
                                             "    def perimeter(self):\n        return self.width * 2 + self.height\n"},
                    "wrong": {"shapes.py": "class Rectangle:\n    def __init__(self, width, height):\n        width = width\n"
                                           "        height = height\n\n    def area(self):\n        return width * height\n\n"
                                           "    def perimeter(self):\n        return 2 * (width + height)\n"},
                },
            },
            {
                "title": "Lab 2 - Bank Account",
                "instructions": "Write a `BankAccount` class with `deposit` and `withdraw` (refuse a withdrawal larger than "
                                "the balance by printing `Insufficient funds`). Read commands until `end`: `deposit 100`, "
                                "`withdraw 30`. Then print `Balance: 70`.",
                "starter": {"main.py": "class BankAccount:\n    def __init__(self):\n        self.balance = 0\n\n"
                                       "    # deposit and withdraw here\n\n\naccount = BankAccount()\nwhile True:\n"
                                       "    line = input()\n    if line == \"end\":\n        break\n    action, amount = line.split()\n"
                                       "    # call the right method\n\nprint(\"Balance:\", account.balance)\n"},
                "tests": [t("Deposit and withdraw", "deposit 100\nwithdraw 30\nend\n", "Balance: 70", False),
                          t("Too much", "deposit 50\nwithdraw 80\nend\n", "Insufficient funds\nBalance: 50", False),
                          t("Nothing", "end\n", "Balance: 0", True),
                          t("Exact balance", "deposit 40\nwithdraw 40\nwithdraw 1\nend\n", "Insufficient funds\nBalance: 0", True)],
                "versions": {
                    "correct": {"main.py": "class BankAccount:\n    def __init__(self):\n        self.balance = 0\n\n"
                                           "    def deposit(self, amount):\n        self.balance += amount\n\n"
                                           "    def withdraw(self, amount):\n        if amount > self.balance:\n"
                                           "            print(\"Insufficient funds\")\n        else:\n            self.balance -= amount\n\n\n"
                                           "account = BankAccount()\nwhile True:\n    line = input()\n    if line == \"end\":\n        break\n"
                                           "    action, amount = line.split()\n    if action == \"deposit\":\n"
                                           "        account.deposit(int(amount))\n    elif action == \"withdraw\":\n"
                                           "        account.withdraw(int(amount))\n\nprint(\"Balance:\", account.balance)\n"},
                    "partial": {"main.py": "class BankAccount:\n    def __init__(self):\n        self.balance = 0\n\n"
                                           "    def deposit(self, amount):\n        self.balance += amount\n\n"
                                           "    def withdraw(self, amount):\n        self.balance -= amount\n\n\n"
                                           "account = BankAccount()\nwhile True:\n    line = input()\n    if line == \"end\":\n        break\n"
                                           "    action, amount = line.split()\n    if action == \"deposit\":\n"
                                           "        account.deposit(int(amount))\n    else:\n        account.withdraw(int(amount))\n\n"
                                           "print(\"Balance:\", account.balance)\n"},
                    "wrong": {"main.py": "class BankAccount:\n    def __init__(self):\n        self.balance = 0\n\n\n"
                                         "account = BankAccount()\nwhile True:\n    line = input()\n    if line == \"end\":\n        break\n\n"
                                         "print(\"Balance:\", account.balance)\n"},
                },
            },
            {
                "title": "Lab 3 - Inheritance: Employees",
                "instructions": "`Employee` has `monthly_pay()` returning its salary. Write `Manager(Employee)` whose pay "
                                "adds a 20% bonus. Read a role (`employee` or `manager`) and a salary; print the pay with "
                                "two decimals: `Pay: 36000.00`.",
                "starter": {"main.py": "class Employee:\n    def __init__(self, salary):\n        self.salary = salary\n\n"
                                       "    def monthly_pay(self):\n        return self.salary\n\n\n# class Manager(Employee): ...\n\n\n"
                                       "role = input(\"Role: \")\nsalary = float(input(\"Salary: \"))\n"
                                       "worker = Employee(salary)\nprint(f\"Pay: {worker.monthly_pay():.2f}\")\n"},
                "tests": [t("Employee", "employee\n25000\n", "Pay: 25000.00", False),
                          t("Manager", "manager\n30000\n", "Pay: 36000.00", False),
                          t("Manager, odd salary", "manager\n12345.5\n", "Pay: 14814.60", True),
                          t("Employee, zero", "employee\n0\n", "Pay: 0.00", True)],
                "versions": {
                    "correct": {"main.py": "class Employee:\n    def __init__(self, salary):\n        self.salary = salary\n\n"
                                           "    def monthly_pay(self):\n        return self.salary\n\n\n"
                                           "class Manager(Employee):\n    def monthly_pay(self):\n        return super().monthly_pay() * 1.2\n\n\n"
                                           "role = input(\"Role: \")\nsalary = float(input(\"Salary: \"))\n"
                                           "worker = Manager(salary) if role == \"manager\" else Employee(salary)\n"
                                           "print(f\"Pay: {worker.monthly_pay():.2f}\")\n"},
                    "partial": {"main.py": "class Employee:\n    def __init__(self, salary):\n        self.salary = salary\n\n"
                                           "    def monthly_pay(self):\n        return self.salary\n\n\n"
                                           "class Manager(Employee):\n    def monthly_pay(self):\n        return self.salary + 6000\n\n\n"
                                           "role = input(\"Role: \")\nsalary = float(input(\"Salary: \"))\n"
                                           "worker = Manager(salary) if role == \"manager\" else Employee(salary)\n"
                                           "print(f\"Pay: {worker.monthly_pay():.2f}\")\n"},
                    "wrong": {"main.py": "class Employee:\n    def __init__(self, salary):\n        self.salary = salary\n\n"
                                         "    def monthly_pay(self):\n        return self.salary\n\n\n"
                                         "role = input(\"Role: \")\nsalary = float(input(\"Salary: \"))\n"
                                         "print(f\"Pay: {salary * 1.2:.2f}\")\n"},
                },
            },
        ],
    },
    {
        "code": "IT 202", "name": "Information Management", "year": 2,
        "activities": [
            {
                "title": "Lab 1 - CSV Report",
                "instructions": "`grades.csv` lists students and their grades. Read a passing grade, then print the names "
                                "of the students at or above it (in file order) and how many there are:\n\n"
                                "```\nAna Cruz\nCarl Reyes\nPassed: 2\n```",
                "starter": {"main.py": "import csv\n\npassing = int(input(\"Passing grade: \"))\n\n# Read grades.csv and print the report\n",
                            "grades.csv": "name,grade\nAna Cruz,91\nBen Lim,74\nCarl Reyes,85\nDina Santos,68\nEli Torres,75\n"},
                "tests": [t("Passing 80", "80\n", "Ana Cruz\nCarl Reyes\nPassed: 2", False),
                          t("Passing 75", "75\n", "Ana Cruz\nCarl Reyes\nEli Torres\nPassed: 3", False),
                          t("Nobody", "95\n", "Passed: 0", True),
                          t("Everybody", "60\n", "Ana Cruz\nBen Lim\nCarl Reyes\nDina Santos\nEli Torres\nPassed: 5", True)],
                "versions": {
                    "correct": {"main.py": 'import csv\n\npassing = int(input("Passing grade: "))\n\ncount = 0\n'
                                           'with open("grades.csv") as f:\n    for row in csv.DictReader(f):\n'
                                           '        if int(row["grade"]) >= passing:\n            print(row["name"])\n            count += 1\n'
                                           'print("Passed:", count)\n'},
                    "partial": {"main.py": 'import csv\n\npassing = int(input("Passing grade: "))\n\ncount = 0\n'
                                           'with open("grades.csv") as f:\n    for row in csv.DictReader(f):\n'
                                           '        if int(row["grade"]) > passing:\n            print(row["name"])\n            count += 1\n'
                                           'print("Passed:", count)\n'},
                    "wrong": {"main.py": 'passing = int(input("Passing grade: "))\n\nwith open("grades.csv") as f:\n'
                                         '    for line in f:\n        name, grade = line.strip().split(",")\n'
                                         '        if int(grade) >= passing:\n            print(name)\n'},
                },
            },
            {
                "title": "Lab 2 - SQLite Basics",
                "instructions": "Read `n`, then `n` lines `name age`. Store them in an **in-memory SQLite table** "
                                "(`sqlite3.connect(\":memory:\")`) and print the names ordered by age, oldest first "
                                "(equal ages by name).",
                "starter": {"main.py": "import sqlite3\n\nconn = sqlite3.connect(\":memory:\")\n"
                                       "conn.execute(\"CREATE TABLE people (name TEXT, age INTEGER)\")\n\n"
                                       "# Insert the rows, then SELECT ... ORDER BY\n"},
                "tests": [t("Three people", "3\nAna 19\nBen 21\nCarl 20\n", "Ben\nCarl\nAna", False),
                          t("One person", "1\nDina 30\n", "Dina", False),
                          t("Same age", "3\nZed 20\nAmy 20\nKim 25\n", "Kim\nAmy\nZed", True),
                          t("Nobody", "0\n", "", True, "exact")],
                "versions": {
                    "correct": {"main.py": 'import sqlite3\n\nconn = sqlite3.connect(":memory:")\n'
                                           'conn.execute("CREATE TABLE people (name TEXT, age INTEGER)")\n\n'
                                           'for _ in range(int(input())):\n    name, age = input().split()\n'
                                           '    conn.execute("INSERT INTO people VALUES (?, ?)", (name, int(age)))\n'
                                           'for (name,) in conn.execute("SELECT name FROM people ORDER BY age DESC, name"):\n'
                                           '    print(name)\n'},
                    "partial": {"main.py": 'import sqlite3\n\nconn = sqlite3.connect(":memory:")\n'
                                           'conn.execute("CREATE TABLE people (name TEXT, age INTEGER)")\n\n'
                                           'for _ in range(int(input())):\n    name, age = input().split()\n'
                                           '    conn.execute("INSERT INTO people VALUES (?, ?)", (name, int(age)))\n'
                                           'for (name,) in conn.execute("SELECT name FROM people ORDER BY age DESC"):\n'
                                           '    print(name)\n'},
                    "wrong": {"main.py": 'import sqlite3\n\nconn = sqlite3.connect(":memory:")\n'
                                         'conn.execute("CREATE TABLE people (name TEXT, age INTEGER)")\n\n'
                                         'for _ in range(int(input())):\n    name, age = input().split()\n'
                                         '    conn.execute(f"INSERT INTO people VALUES (\'{name}\', {age})")\n'
                                         'for row in conn.execute("SELECT * FROM people ORDER BY age"):\n    print(row)\n'},
                },
            },
            {
                "title": "Lab 3 - Dictionary Inventory",
                "instructions": "Read lines `item quantity` until `done`. The same item may appear more than once: add the "
                                "quantities up. Print every item in alphabetical order as `item: total`.",
                "starter": {"main.py": "stock = {}\n\n# Read until done, then print the totals\n"},
                "tests": [t("Repeated item", "pen 5\nink 2\npen 3\ndone\n", "ink: 2\npen: 8", False),
                          t("Single item", "cap 1\ndone\n", "cap: 1", False),
                          t("Empty", "done\n", "", True, "exact"),
                          t("Alphabetical", "zip 1\napple 4\nmango 2\napple 1\ndone\n", "apple: 5\nmango: 2\nzip: 1", True)],
                "versions": {
                    "correct": {"main.py": 'stock = {}\n\nwhile True:\n    line = input()\n    if line == "done":\n        break\n'
                                           '    item, qty = line.split()\n    stock[item] = stock.get(item, 0) + int(qty)\n\n'
                                           'for item in sorted(stock):\n    print(f"{item}: {stock[item]}")\n'},
                    "partial": {"main.py": 'stock = {}\n\nwhile True:\n    line = input()\n    if line == "done":\n        break\n'
                                           '    item, qty = line.split()\n    stock[item] = int(qty)\n\n'
                                           'for item in sorted(stock):\n    print(f"{item}: {stock[item]}")\n'},
                    "wrong": {"main.py": 'stock = {}\n\nwhile True:\n    line = input()\n    if line == "done":\n        break\n'
                                         '    item, qty = line.split()\n    stock[item] = stock.get(item, 0) + int(qty)\n\n'
                                         'print(stock)\n'},
                },
            },
        ],
    },
]
