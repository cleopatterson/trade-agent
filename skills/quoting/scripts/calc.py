#!/usr/bin/env python3
"""
Simple calculator for quoting skill.
Usage: python calc.py "30 / 15 * 80 + 300"
"""
import sys

if len(sys.argv) < 2:
    print("Usage: python calc.py 'expression'")
    print("Example: python calc.py '30 / 15 * 80 + 300'")
    sys.exit(1)

try:
    result = eval(sys.argv[1])
    # Format nicely - no decimals if whole number, 2 decimals otherwise
    if isinstance(result, float) and result == int(result):
        print(int(result))
    else:
        print(f"{result:.2f}" if isinstance(result, float) else result)
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
