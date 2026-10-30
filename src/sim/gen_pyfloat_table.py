"""Generates src/sim/__fixtures__/pyfloat-table.json (design.md §5.1, tasks A.1).

The table is the reference for `formatPyFloat`, `pyStr` and the int/float arithmetic in
`pyvalues.ts`. Regenerate with:

    python src/sim/gen_pyfloat_table.py > src/sim/__fixtures__/pyfloat-table.json
    pnpm exec prettier --write src/sim/__fixtures__/pyfloat-table.json

Values are encoded as {"t": "int"|"float", "v": <number>}; floats additionally carry their
Python repr in "r" so that -0.0 and exact digits survive JSON. Non-finite results are encoded
as {"t": "float", "r": "inf"|"-inf"|"nan"} (no "v").
"""
import json
import math
import random
import sys

random.seed(20260101)


def enc(x):
    if isinstance(x, bool):
        raise TypeError("bool")
    if isinstance(x, int):
        return {"t": "int", "v": x}
    if math.isfinite(x):
        return {"t": "float", "v": x, "r": repr(x)}
    return {"t": "float", "r": repr(x)}


# ------------------------------------------------------------------ repr table
floats = [
    0.0, -0.0, 1.0, -1.0, 0.1, 0.2, 0.3, 0.1 + 0.2, 1 / 3, 2 / 3, 10 / 3, 0.5, 1.5, 2.5,
    100.0, 1234.5, 1e15, 1e16, 1e17, 9999999999999998.0, 1.2345e16, 123456789012345.6,
    1e-4, 1e-5, 1.5e-5, 0.00012345, 0.0001, 0.001, 1e-7, 1e-10, 5e-324, 2.2250738585072014e-308,
    1.7976931348623157e308, 1e308, 1e100, 1e-100, 1e22, 1e21, 1e20, 123e18,
    3.141592653589793, 2.718281828459045, 1.4142135623730951, 0.30000000000000004,
    4.35, 0.07, 1.1, 2.675, 9007199254740992.0, 9007199254740993.0, 4503599627370496.5,
    -123.456, -1e-5, -1e16, -0.001, 12.0, 120.0, 1200000.0, 0.000123, 1e-06, 9.999e15,
    9.9999e-5, 99999999999999.99, 1e300 * 10, 123456.789e3,
]
for _ in range(120):
    m = random.random() * 10
    e = random.randint(-30, 30)
    s = random.choice([1, -1])
    floats.append(s * m * 10.0 ** e)
for _ in range(40):
    floats.append(random.randint(-10**6, 10**6) / random.choice([2, 4, 8, 10, 100, 1000, 3, 7]))
for _ in range(20):
    floats.append(float(random.randint(-10**17, 10**17)))

repr_rows = [{"v": x, "r": repr(x)} for x in floats if math.isfinite(x)]

# ------------------------------------------------------------- arithmetic table
operands = [
    0, 1, -1, 2, -3, 7, -7, 13, 2**31, -(2**40) + 5,
    0.0, -0.0, 0.5, -1.5, 2.0, 7.5, -7.5, 0.1, 1e-5, 1e16, 1e308,
]
ops = ["+", "-", "*", "/", "//", "%"]


def apply(a, op, b):
    if op == "+":
        return a + b
    if op == "-":
        return a - b
    if op == "*":
        return a * b
    if op == "/":
        return a / b
    if op == "//":
        return a // b
    return a % b


SAFE = 2**53 - 1
arith_rows = []
for a in operands:
    for b in operands:
        for op in ops:
            try:
                r = apply(a, op, b)
            except ZeroDivisionError:
                arith_rows.append({"a": enc(a), "op": op, "b": enc(b), "error": "DIVISION_BY_ZERO"})
                continue
            if isinstance(r, int) and abs(r) > SAFE:
                arith_rows.append({"a": enc(a), "op": op, "b": enc(b), "error": "INT_OVERFLOW"})
                continue
            arith_rows.append({"a": enc(a), "op": op, "b": enc(b), "result": enc(r)})

# -------------------------------------------------------------------- str table
str_rows = [{"value": enc(x), "str": str(x)} for x in [0, -5, 123456789, 2**53 - 1, -(2**53 - 1)]]

def dump_rows(rows):
    return ",\n".join("    " + json.dumps(r, allow_nan=False, separators=(",", ":")) for r in rows)


sys.stdout.write("{\n")
sys.stdout.write('  "repr": [\n' + dump_rows(repr_rows) + "\n  ],\n")
sys.stdout.write('  "arith": [\n' + dump_rows(arith_rows) + "\n  ],\n")
sys.stdout.write('  "str": [\n' + dump_rows(str_rows) + "\n  ]\n")
sys.stdout.write("}\n")
