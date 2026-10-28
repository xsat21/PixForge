"""Generate tiny, original PixForge fixtures; no private or third-party images.
Requires Pillow and pillow-heif (only for fixture regeneration, not the app).
Run from the repo root: python tests/fixtures/generate.py
"""
from pathlib import Path
from PIL import Image
import pillow_heif

pillow_heif.register_heif_opener()
root = Path(__file__).parent
# Four colored quadrants let browser tests check container orientation, not just dimensions.
image = Image.new('RGB', (64, 40))
for y in range(40):
    for x in range(64):
        image.putpixel((x, y), ((230, 30, 30) if x < 32 else (30, 210, 30)) if y < 20 else ((30, 30, 230) if x < 32 else (230, 210, 30)))
image.save(root / 'sample.heic', quality=95)
image.save(root / 'sample.jpg', quality=95)
image.save(root / 'sample.webp', quality=95)
image.save(root / 'sample.png')
rotated = image.copy()
exif = Image.Exif()
exif[274] = 6  # 90 degrees clockwise; the writer expresses it as HEIF irot.
rotated.save(root / 'rotated.heic', quality=95, exif=exif.tobytes())
alpha = image.convert('RGBA')
for y in range(40):
    for x in range(8):
        alpha.putpixel((x, y), (230, 30, 30, 0))
alpha.save(root / 'alpha.heic', quality=95)
alpha.save(root / 'sample.avif', quality=95, speed=6)
probe = Image.new('RGB', (1, 1), (255, 255, 255))
probe.save(root / 'probe.avif', quality=80, speed=6)
for name in ['sample.heic', 'rotated.heic', 'alpha.heic', 'sample.avif', 'probe.avif']:
    with Image.open(root / name) as decoded:
        print(name, (root / name).stat().st_size, decoded.size, decoded.mode, decoded.getexif().get(274))
