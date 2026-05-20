#!/usr/bin/env python3
"""PyPDF2 text extraction: python pdf_text.py input.pdf"""
import sys
try:
    from PyPDF2 import PdfReader
    if len(sys.argv) < 2:
        print(f"用法: {sys.argv[0]} input.pdf")
        sys.exit(1)
    reader = PdfReader(sys.argv[1])
    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        if text:
            print(f"\n--- Page {i+1} ---")
            print(text)
    print(f"\n✓ 文本提取完成: {len(reader.pages)} 页")
except ImportError:
    print("PyPDF2 未安装。运行: pip install PyPDF2")
    sys.exit(1)
