# -*- coding: utf-8 -*-
"""
渲染史记姜立纲本 PDF 左半叶为 PNG（供 grid-transcribe 使用）。
支持 004-009 六卷。
"""
import fitz, os, sys

script_dir = os.path.dirname(os.path.abspath(__file__))
# 主仓库根目录
main_root = os.path.dirname(script_dir)

base = os.path.join(main_root, 'input_data', '史记_姜立纲本', '史记整理目录')
pdf_dir = os.path.join(base, '史记_姜立纲本pdf')
ocr_base = os.path.join(base, '史记_姜立纲本ocr')

# 004-009 六卷：(目录名, OCR起始页码)
chapters = [
    ('004_周本纪', 39),
    ('005_秦始皇本纪', 98),
    ('006_项羽本纪', 143),
    ('007_高祖本纪', 172),
    ('008_孝文本纪', 221),
    ('009_孝景本纪', 239),
]

total = 0
for ch, ocr_start in chapters:
    pdf_path = os.path.join(pdf_dir, f'{ch}.pdf')
    if not os.path.exists(pdf_path):
        print(f'ERROR: PDF not found: {pdf_path}')
        continue
    doc = fitz.open(pdf_path)
    n_pages = doc.page_count
    
    out_dir = os.path.join(ocr_base, ch, 'imgs')
    os.makedirs(out_dir, exist_ok=True)
    
    for i in range(n_pages):
        pg = doc[i]
        w, h = pg.rect.width, pg.rect.height
        mid = w / 2
        
        left_clip = fitz.Rect(0, 0, mid, h)
        mat = fitz.Matrix(2.0, 2.0)
        pix = pg.get_pixmap(matrix=mat, clip=left_clip)
        
        ocr_page = ocr_start + i
        out_path = os.path.join(out_dir, f'page_{ocr_page:04d}.png')
        pix.save(out_path)
        total += 1
    
    doc.close()
    print(f'{ch}: {n_pages} PDF pages -> OCR {ocr_start}-{ocr_start + n_pages - 1}')

print(f'\nTotal: {total} half-leaf PNGs rendered')
