#!/usr/bin/env python3
"""PDF 单页渲染辅助脚本（pypdfium2 → PNG）。供 Node.js collation 管线调用。"""
import sys, os
try:
    import pypdfium2 as pdfium
except ImportError:
    print("ERROR: pypdfium2 not installed. Run: python -m pip install pypdfium2", file=sys.stderr)
    sys.exit(1)

def main():
    if len(sys.argv) < 5:
        print(f"Usage: {sys.argv[0]} <pdf_path> <page_n> <dpi> <output_png>", file=sys.stderr)
        sys.exit(1)
    pdf_path = sys.argv[1]
    page_n = int(sys.argv[2])
    dpi = int(sys.argv[3])
    output = sys.argv[4]
    
    pdf = pdfium.PdfDocument(pdf_path)
    page = pdf[page_n - 1]  # 1-based → 0-based
    scale = dpi / 72.0
    bmp = page.render(scale=scale)
    img = bmp.to_pil()
    img.save(output, "PNG")
    print(f"OK {img.size[0]}x{img.size[1]}")

if __name__ == "__main__":
    main()
