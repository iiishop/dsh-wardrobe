#!/usr/bin/env python3
"""把「正面 + 侧面」双视图的服装图裁成单人。

用法: python3 crop-two-view.py <src> <dst>

判据（不猜，量出来）：
  背景 = 三通道都接近白/浅灰；逐列统计非背景像素数，
  在中间 40% 找最宽的低谷；低谷足够深（低于画面高度的 2%）才认为这里是两个人之间的缝。
  找不到缝就原样复制——宁可保留双视图，也不能把一件衣服裁掉一半。
"""
import sys
from pathlib import Path
from PIL import Image

BG_MIN = 232          # 三通道都不低于它
BG_SPREAD = 14        # 且通道差不大 → 算背景
VALLEY_MAX = 0.02     # 低谷占比低于 2% 才认
MID_LO, MID_HI = 0.22, 0.78   # 只在中间找缝，避免把左侧留白当缝


def column_ink(img):
    w, h = img.size
    px = img.convert('RGB').load()
    step = max(1, h // 400)          # 抽样，够判就行
    ink = [0] * w
    for x in range(w):
        n = 0
        for y in range(0, h, step):
            r, g, b = px[x, y]
            if min(r, g, b) < BG_MIN or (max(r, g, b) - min(r, g, b)) > BG_SPREAD:
                n += 1
        ink[x] = n
    return ink, len(range(0, h, step))


def find_split(ink, rows):
    w = len(ink)
    lo, hi = int(w * MID_LO), int(w * MID_HI)
    threshold = max(1, int(rows * VALLEY_MAX))
    best = None
    run = 0
    for x in range(lo, hi):
        if ink[x] <= threshold:
            run += 1
            if best is None or run > best[1]:
                best = (x, run)
        else:
            run = 0
    if best and best[1] >= max(4, int(w * 0.01)):
        return best[0] - best[1] // 2      # 缝的中心
    return None


def trim(img):
    """裁掉四周纯背景，避免把大片留白喂给模型。"""
    from PIL import ImageChops
    bg = Image.new('RGB', img.size, (255, 255, 255))
    diff = ImageChops.difference(img.convert('RGB'), bg)
    box = diff.point(lambda v: 255 if v > 12 else 0).convert('L').getbbox()
    return img.crop(box) if box else img


def main():
    if len(sys.argv) != 3:
        print('用法: crop-two-view.py <src> <dst>', file=sys.stderr)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    img = Image.open(src)
    ink, rows = column_ink(img)
    split = find_split(ink, rows)
    if split is None:
        img.save(dst)
        print(f'no-split {img.size[0]}x{img.size[1]}')
        return 0
    left = trim(img.crop((0, 0, split, img.size[1])))
    right = trim(img.crop((split, 0, img.size[0], img.size[1])))
    # 两半都要：左边当正面写进 dst，右边同目录同名加 _back。
    # 只留正面会把「设计在后背」的衣服（深 U 露背、连体泳衣的 U 领）丢掉一半信息。
    left.save(dst)
    back = back_path(dst)
    right.save(back)
    print(f'split@{split} {img.size[0]}x{img.size[1]} → '
          f'left {left.size[0]}x{left.size[1]} right {right.size[0]}x{right.size[1]}')
    return 0


def back_path(dst):
    p = Path(dst)
    return str(p.with_name(f'{p.stem}_back{p.suffix}'))


if __name__ == '__main__':
    sys.exit(main())
