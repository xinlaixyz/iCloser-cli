#!/usr/bin/env python3
"""PyPDF2 rotate: python pdf_rotate.py input.pdf degrees [output.pdf]"""
import sys
try:
    from PyPDF2 import PdfReader, PdfWriter
    if len(sys.argv) < 3:
        print(f"用法: {sys.argv[0]} input.pdf degrees [output.pdf]")
        sys.exit(1)
    input_file = sys.argv[1]
    degrees = int(sys.argv[2])
    output = sys.argv[3] if len(sys.argv) > 3 else f"rotated_{degrees}.pdf"
    reader = PdfReader(input_file)
    writer = PdfWriter()
    for page in reader.pages:
        page.rotate(degrees)
        writer.add_page(page)
    writer.write(output)
    print(f"✓ 旋转完成: {output} ({degrees}°)")
except ImportError:
    print("PyPDF2 未安装。运行: pip install PyPDF2")
    sys.exit(1)
