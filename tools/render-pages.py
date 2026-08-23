# -*- coding: utf-8 -*-
"""
渲染史记姜立纲本 PDF 左半叶为 PNG（供 grid-transcribe 使用）。
"""
import fitz, os, sys

# Worktree 结构: .claude/worktrees/shiji-grid/
# 主仓库: e:\git_project\lan_mu\
# 需要向上 3 级: tools/ -> shiji-grid/ -> worktrees/ -> .claude/ -> lan_mu/
script_dir = os.path.dirname(os.path.abspath(__file__))
# tools/render-pages.py -> script_dir = .../shiji-grid/tools
worktree_root = os.path.dirname(script_dir)  # .../shiji-grid
# 向上找到主仓库根（包含 input_data 的目录）
main_root = os.path.dirname(os.path.dirname(os.path.dirname(worktree_root)))

base = os.path.join(main_root, 'input_data', '史记_姜立纲本', '史记整理目录')
pdf_dir = os.path.join(base, '史记_姜立纲本pdf')
ocr_base = os.path.join(base, '史记_姜立纲本ocr')

print(f'Main root: {main_root}')
print(f'PDF dir exists: {os.path.isdir(pdf_dir)}')
if os.path.isdir(pdf_dir):
    print(f'PDFs: {[f for f in os.listdir(pdf_dir) if f.endswith(".pdf")][:3]}')

chapters = [
    ('001_五帝本纪', 6),
    ('002_夏本纪', 18),
    ('003_殷本纪', 29),
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
    print(f'{ch}: {n_pages} pages -> OCR {ocr_start}-{ocr_start + n_pages - 1}')

print(f'\nTotal: {total} half-leaf PNGs rendered')
