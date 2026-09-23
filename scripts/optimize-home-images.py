"""Generate responsive WebP copies of existing homepage photography."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
sources = list((root / 'images/collections').glob('*-tile.jpg'))
sources.append(root / 'images/jeff-editorial-portrait.jpg')
for source in sources:
    widths = [320] if 'portrait' in source.name else [384, 768]
    for width in widths:
        with Image.open(source) as image:
            image.thumbnail((width, width * 2), Image.Resampling.LANCZOS)
            destination = source.with_name(f'{source.stem}-{width}.webp')
            image.save(destination, 'WEBP', quality=82, method=6)
            print(f'{destination.relative_to(root)}: {destination.stat().st_size} bytes')
