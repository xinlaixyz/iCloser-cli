#!/usr/bin/env python3
"""PyPDF2 merge: python pdf_merge.py output.pdf input1.pdf input2.pdf ..."""
import sys
try:
    from PyPDF2 import PdfMerger
    if len(sys.argv) < 4:
        print(f"用法: {sys.argv[0]} output.pdf input1.pdf input2.pdf ...")
        sys.exit(1)
    output = sys.argv[1]
    inputs = sys.argv[2:]
    merger = PdfMerger()
    for f in inputs:
        merger.append(f)
        print(f"  + {f}")
    merger.write(output)
    merger.close()
    print(f"✓ 合并完成: {output} ({len(inputs)} 个文件)")
except ImportError:
    print("PyPDF2 未安装。运行: pip install PyPDF2")
    sys.exit(1)
