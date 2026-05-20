#!/usr/bin/env python3
"""PyPDF2 split: python pdf_split.py input.pdf [pages_per_split]"""
import sys
try:
    from PyPDF2 import PdfReader, PdfWriter
    if len(sys.argv) < 2:
        print(f"用法: {sys.argv[0]} input.pdf [pages_per_split=1]")
        sys.exit(1)
    input_file = sys.argv[1]
    per_split = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    reader = PdfReader(input_file)
    total = len(reader.pages)
    for i in range(0, total, per_split):
        writer = PdfWriter()
        for j in range(i, min(i + per_split, total)):
            writer.add_page(reader.pages[j])
        out = f"page_{i+1}.pdf" if per_split == 1 else f"pages_{i+1}-{min(i+per_split,total)}.pdf"
        writer.write(out)
        print(f"  → {out}")
    print(f"✓ 拆分完成: {total} 页 → {per_split} 页/文件")
except ImportError:
    print("PyPDF2 未安装。运行: pip install PyPDF2")
    sys.exit(1)
