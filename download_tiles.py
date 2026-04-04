"""
OVERSEER — UK Tile Downloader
Downloads OpenStreetMap tiles and packages into MBTiles (SQLite).
No external dependencies — uses only Python3 stdlib.
Called by download-uk-tiles.sh, reads MBTILES_OUTPUT env var.
"""
import sqlite3
import urllib.request
import math
import sys
import os
import time

WEST, SOUTH, EAST, NORTH = -10.5, 49.5, 2.0, 61.0
MIN_ZOOM, MAX_ZOOM = 0, 14
OUTPUT = os.environ.get("MBTILES_OUTPUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "tiles", "uk.mbtiles"))

TILE_SERVERS = [
    "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
    "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
    "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
]


def lon_to_tile(lon, zoom):
    return int((lon + 180.0) / 360.0 * (2 ** zoom))


def lat_to_tile(lat, zoom):
    lat_rad = math.radians(lat)
    return int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * (2 ** zoom))


def count_tiles():
    total = 0
    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        x_min = max(0, lon_to_tile(WEST, z))
        x_max = min(2**z - 1, lon_to_tile(EAST, z))
        y_min = max(0, lat_to_tile(NORTH, z))
        y_max = min(2**z - 1, lat_to_tile(SOUTH, z))
        total += (x_max - x_min + 1) * (y_max - y_min + 1)
    return total


def main():
    print(f"Output: {OUTPUT}")
    print()

    # Create MBTiles database
    db = sqlite3.connect(OUTPUT)
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT);
        CREATE TABLE IF NOT EXISTS tiles (
            zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB
        );
        CREATE UNIQUE INDEX IF NOT EXISTS tile_index
            ON tiles (zoom_level, tile_column, tile_row);
    """)
    db.executemany("INSERT INTO metadata (name, value) VALUES (?, ?)", [
        ("name", "United Kingdom"),
        ("format", "png"),
        ("bounds", f"{WEST},{SOUTH},{EAST},{NORTH}"),
        ("center", f"{(WEST + EAST) / 2},{(SOUTH + NORTH) / 2},6"),
        ("minzoom", str(MIN_ZOOM)),
        ("maxzoom", str(MAX_ZOOM)),
        ("type", "baselayer"),
        ("attribution", "OpenStreetMap contributors"),
    ])
    db.commit()

    total = count_tiles()
    print(f"Total tiles to download: {total:,}")
    print()

    # Set up request headers (OSM requires a User-Agent)
    opener = urllib.request.build_opener()
    opener.addheaders = [
        ("User-Agent", "OVERSEER-TileDownloader/1.0 (offline survival platform)")
    ]
    urllib.request.install_opener(opener)

    downloaded = 0
    errors = 0
    start_time = time.time()
    server_idx = 0
    batch = []

    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        x_min = max(0, lon_to_tile(WEST, z))
        x_max = min(2**z - 1, lon_to_tile(EAST, z))
        y_min = max(0, lat_to_tile(NORTH, z))
        y_max = min(2**z - 1, lat_to_tile(SOUTH, z))
        zoom_tiles = (x_max - x_min + 1) * (y_max - y_min + 1)
        print(f"Zoom {z:2d}: {zoom_tiles:>8,} tiles (x:{x_min}-{x_max}, y:{y_min}-{y_max})")

        for x in range(x_min, x_max + 1):
            for y in range(y_min, y_max + 1):
                tms_y = (2 ** z - 1) - y
                url = TILE_SERVERS[server_idx % len(TILE_SERVERS)].format(z=z, x=x, y=y)
                server_idx += 1

                for attempt in range(3):
                    try:
                        resp = urllib.request.urlopen(url, timeout=15)
                        tile_data = resp.read()
                        batch.append((z, x, tms_y, tile_data))
                        downloaded += 1
                        break
                    except Exception:
                        if attempt == 2:
                            errors += 1
                        else:
                            time.sleep(1)

                # Batch insert every 100 tiles
                if len(batch) >= 100:
                    db.executemany(
                        "INSERT OR REPLACE INTO tiles "
                        "(zoom_level, tile_column, tile_row, tile_data) "
                        "VALUES (?, ?, ?, ?)",
                        batch,
                    )
                    db.commit()
                    batch = []

                # Progress every 500 tiles
                if downloaded % 500 == 0 and downloaded > 0:
                    elapsed = time.time() - start_time
                    rate = downloaded / elapsed if elapsed > 0 else 0
                    eta = (total - downloaded) / rate if rate > 0 else 0
                    sys.stdout.write(
                        f"\r  Progress: {downloaded:,}/{total:,} "
                        f"({downloaded * 100 // total}%) | "
                        f"{rate:.0f} tiles/s | "
                        f"ETA: {int(eta // 60)}m {int(eta % 60)}s | "
                        f"Errors: {errors}   "
                    )
                    sys.stdout.flush()

                # Rate limit: be polite to OSM tile servers
                time.sleep(0.05)

    # Flush remaining
    if batch:
        db.executemany(
            "INSERT OR REPLACE INTO tiles "
            "(zoom_level, tile_column, tile_row, tile_data) "
            "VALUES (?, ?, ?, ?)",
            batch,
        )
        db.commit()

    db.close()

    elapsed = time.time() - start_time
    print()
    print()
    print(f"Download complete: {downloaded:,} tiles in {int(elapsed // 60)}m {int(elapsed % 60)}s")
    print(f"Errors: {errors}")


if __name__ == "__main__":
    main()
