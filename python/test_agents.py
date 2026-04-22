import pytest
import os
from hello import main as hello_main
from basic import main as basic_main

def test_hello_runs():
    # We just want to ensure it doesn't crash
    try:
        hello_main()
    except Exception as e:
        pytest.fail(f"hello.py raised an exception: {e}")

def test_basic_runs():
    try:
        basic_main()
    except Exception as e:
        pytest.fail(f"basic.py raised an exception: {e}")
