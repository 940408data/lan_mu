# -*- coding: utf-8 -*-
"""
渲染史记姜立纲本 PDF 跨页为半叶 PNG（供 grid-transcribe 使用）。
每页 PDF = 一个双叶跨页（1080×1008），裁切为左右两个半叶。
页码映射：OCR page_0006 = PDF 0 右半叶，page_0007 = PDF 0 左半叶，...
用法：python render-half-leaves.py [章节编号] [起始PDF页] [结束PDF页]
"""
import fitz, os, sys, math

def render_chapter(pdf_path, out_dir, ocr_page_start, pdf_start=0, pdf_end=None):
    """渲染一个章节的 PDF 跨页为半叶 PNG"""
    doc = fitz.open(pdf_path)
    if pdf_end is None:
        pdf_end = doc.page_count - 1
    
    os.makedirs(out_dir, exist_ok=True)
    ocr_page = ocr_page_start
    
    for pg_idx in range(pdf_start, pdf_end + 1):
        pg = doc[pg_idx]
        # 渲染为 2x 分辨率（2160×2016）
        mat = fitz.Matrix(2.0, 2.0)
        pix = pg.get_pixmap(matrix=mat)
        
        w, h = pix.width, pix.height
        mid = w // 2
        
        # 右半叶（先读）
        right_rect = fitz.Rect(mid, 0, w, h)
        right_pix = fitz.Pixmap(pix, right_rect)
        right_path = os.path.join(out_dir, f'page_{ocr_page:04d}.png')
        right_pix.save(right_path)
        
        # 左半叶（后读）
        left_rect = fitz.Rect(0, 0, mid, h)
        left_pix = fitz.Pixmap(pix, left_rect)
        left_path = os.path.join(out_dir, f'page_{ocr_page+1:04d}.png')
        left_pix.save(left_path)
        
        print(f'PDF p{pg_idx} → OCR page_{ocr_page:04d} (右) + page_{ocr_page+1:04d} (左)')
        ocr_page += 2
    
    doc.close()
    return ocr_page

if __name__ == '__main__':
    base = r'input_data/史记_姜立纲本/史记整理目录'
    pdf_dir = os.path.join(base, '史记_姜立纲本pdf')
    ocr_base = os.path.join(base, '史记_姜立纲本ocr')
    
    # 默认渲染前三卷
    chapters = [
        ('001_五帝本纪', 6),   # 12 PDF pages → 24 half-leaves (OCR 6-29)
        ('002_夏本纪', None),  # auto-calc
        ('003_殷本纪', None),
    ]
    
    # 计算各卷 OCR 起始页
    cum = 6  # 第一卷从 page 6 开始
    for i, (ch, _) in enumerate(chapters):
        pdf_path = os.path.join(pdf_dir, f'{ch}.pdf')
        doc = fitz.open(pdf_path)
        n_pages = doc.page_count
        doc.close()
        
        if chapters[i][1] is None:
            chapters[i] = (ch, cum)
        
        out_dir = os.path.join(ocr_base, ch, 'imgs')
        render_chapter(pdf_path, out_dir, cum, 0, n_pages - 1)
        cum += n_pages * 2
        print(f'--- {ch}: {n_pages} spreads → {n_pages*2} half-leaves (OCR {chapters[i][1]}-{cum-1}) ---')
    
    print('done')
