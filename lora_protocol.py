"""
OVERSEER LoRa Protocol — Binary packet encoder/decoder.

10-byte header + up to 218 bytes payload per Meshtastic packet (228 max).

Header layout:
  [0]     Version (high nibble) + Flags (low nibble)
  [1]     Message type
  [2-3]   Message ID (uint16, big-endian, wrapping counter)
  [4]     Sender ID (uint8)
  [5]     Recipient ID (uint8)
  [6]     Chunk index (uint8)
  [7]     Total chunks (uint8)
  [8]     Payload length (uint8, max 218)
  [9]     CRC8 of bytes [0..8]
  [10-227] Payload
"""

import struct
import zstandard as zstd
from enum import IntEnum
from dataclasses import dataclass, field
from typing import Optional
import time
import os

# ── Constants ──────────────────────────────────────────────────────────────

PROTOCOL_VERSION = 1
HEADER_SIZE = 10
MAX_PACKET_SIZE = 228
MAX_PAYLOAD_SIZE = MAX_PACKET_SIZE - HEADER_SIZE  # 218

# Flags (low nibble of byte 0)
FLAG_CHUNKED    = 0x01
FLAG_ENCRYPTED  = 0x02
FLAG_COMPRESSED = 0x04

# Chunk reassembly
CHUNK_TIMEOUT_S = 60  # seconds to wait for all chunks before giving up
NACK_TIMEOUT_S = 30   # seconds before requesting retransmit of missing chunks


class MsgType(IntEnum):
    """Protocol message types."""
    # Chat
    TEXT        = 0x01
    ACK         = 0x02
    CANCEL      = 0x03
    PING        = 0x04
    PONG        = 0x05
    SYNC_REQ    = 0x06
    SYNC_DATA   = 0x07
    # LLM
    LLM_QUERY   = 0x10
    LLM_RESP    = 0x11
    # Knowledge Base
    KB_SEARCH   = 0x20
    KB_RESULTS  = 0x21
    KB_FETCH    = 0x22
    KB_ARTICLE  = 0x23
    # Identity
    KEY_EXCHANGE = 0x30


# ── CRC-8 (CCITT polynomial 0x07) ─────────────────────────────────────────

def _crc8(data: bytes) -> int:
    crc = 0x00
    for b in data:
        crc ^= b
        for _ in range(8):
            if crc & 0x80:
                crc = ((crc << 1) ^ 0x07) & 0xFF
            else:
                crc = (crc << 1) & 0xFF
    return crc


# ── Packet dataclass ──────────────────────────────────────────────────────

@dataclass
class Packet:
    """A single LoRa protocol packet."""
    msg_type: int
    msg_id: int
    sender_id: int
    recipient_id: int
    payload: bytes = b""
    chunk_index: int = 0
    total_chunks: int = 1
    flags: int = 0
    version: int = PROTOCOL_VERSION

    def encode(self) -> bytes:
        """Encode packet to binary wire format."""
        if len(self.payload) > MAX_PAYLOAD_SIZE:
            raise ValueError(f"Payload {len(self.payload)} exceeds max {MAX_PAYLOAD_SIZE}")

        header = bytearray(HEADER_SIZE)
        header[0] = ((self.version & 0x0F) << 4) | (self.flags & 0x0F)
        header[1] = self.msg_type & 0xFF
        struct.pack_into(">H", header, 2, self.msg_id & 0xFFFF)
        header[4] = self.sender_id & 0xFF
        header[5] = self.recipient_id & 0xFF
        header[6] = self.chunk_index & 0xFF
        header[7] = self.total_chunks & 0xFF
        header[8] = len(self.payload) & 0xFF
        header[9] = _crc8(bytes(header[:9]))

        return bytes(header) + self.payload

    @classmethod
    def decode(cls, data: bytes) -> "Packet":
        """Decode binary wire format to Packet."""
        if len(data) < HEADER_SIZE:
            raise ValueError(f"Packet too short: {len(data)} < {HEADER_SIZE}")

        # Verify CRC
        expected_crc = _crc8(data[:9])
        if data[9] != expected_crc:
            raise ValueError(f"CRC mismatch: got 0x{data[9]:02X}, expected 0x{expected_crc:02X}")

        version = (data[0] >> 4) & 0x0F
        flags = data[0] & 0x0F
        msg_type = data[1]
        msg_id = struct.unpack_from(">H", data, 2)[0]
        sender_id = data[4]
        recipient_id = data[5]
        chunk_index = data[6]
        total_chunks = data[7]
        payload_len = data[8]

        if len(data) < HEADER_SIZE + payload_len:
            raise ValueError(f"Packet truncated: expected {HEADER_SIZE + payload_len}, got {len(data)}")

        payload = data[HEADER_SIZE : HEADER_SIZE + payload_len]

        return cls(
            version=version,
            flags=flags,
            msg_type=msg_type,
            msg_id=msg_id,
            sender_id=sender_id,
            recipient_id=recipient_id,
            chunk_index=chunk_index,
            total_chunks=total_chunks,
            payload=payload,
        )


# ── Message ID counter ────────────────────────────────────────────────────

_msg_id_counter = 0

def next_msg_id() -> int:
    """Get next wrapping uint16 message ID."""
    global _msg_id_counter
    _msg_id_counter = (_msg_id_counter + 1) & 0xFFFF
    return _msg_id_counter


# ── Compression ───────────────────────────────────────────────────────────

# Minimum payload size to bother compressing (overhead not worth it below this)
COMPRESS_THRESHOLD = 50

_compressor: Optional[zstd.ZstdCompressor] = None
_decompressor: Optional[zstd.ZstdDecompressor] = None


def load_dictionary(dict_path: str) -> None:
    """Load a pre-trained zstd dictionary for compression/decompression."""
    global _compressor, _decompressor
    if os.path.exists(dict_path):
        dict_data = zstd.ZstdCompressionDict(open(dict_path, "rb").read())
        _compressor = zstd.ZstdCompressor(level=19, dict_data=dict_data)
        _decompressor = zstd.ZstdDecompressor(dict_data=dict_data)
    else:
        # No dictionary — use plain zstd at high compression
        _compressor = zstd.ZstdCompressor(level=19)
        _decompressor = zstd.ZstdDecompressor()


def _ensure_compressor():
    """Lazy-init compressor without dictionary if not yet loaded."""
    global _compressor, _decompressor
    if _compressor is None:
        _compressor = zstd.ZstdCompressor(level=19)
        _decompressor = zstd.ZstdDecompressor()


def compress(data: bytes) -> tuple[bytes, bool]:
    """Compress data with zstd. Returns (output, was_compressed).
    Skips compression if data is too small or compression doesn't help."""
    if len(data) < COMPRESS_THRESHOLD:
        return data, False
    _ensure_compressor()
    compressed = _compressor.compress(data)
    if len(compressed) >= len(data):
        return data, False  # compression didn't help
    return compressed, True


def decompress(data: bytes) -> bytes:
    """Decompress zstd data."""
    _ensure_compressor()
    return _decompressor.decompress(data)


# ── Chunking ──────────────────────────────────────────────────────────────

def chunk_payload(
    data: bytes,
    msg_type: int,
    msg_id: int,
    sender_id: int,
    recipient_id: int,
    max_chunk_payload: int = MAX_PAYLOAD_SIZE,
    encrypt_fn=None,
) -> list[Packet]:
    """Split a payload into independently-compressed chunks, each fitting one LoRa packet.

    For progressive rendering: each chunk is compressed independently so the
    receiver can decompress and display as chunks arrive.

    Args:
        data: Raw text/binary to send.
        msg_type: Protocol message type for all chunks.
        msg_id: Shared message ID across all chunks.
        sender_id: Sender user ID.
        recipient_id: Recipient user ID.
        max_chunk_payload: Max bytes per chunk payload (after compression/encryption).
        encrypt_fn: Optional callable(bytes) -> bytes for encryption. Applied after compression.

    Returns:
        List of Packet objects ready to encode and transmit.
    """
    # Calculate effective payload budget per chunk
    # We need to leave room for compression/encryption overhead, so we
    # chunk the raw data conservatively, then compress each chunk.
    # Start with raw chunks sized to fit after compression.
    # Since compression ratio varies, we use an iterative approach:
    # try a chunk size, compress, and adjust if it doesn't fit.

    if len(data) == 0:
        # Single empty packet
        flags = 0
        return [Packet(
            msg_type=msg_type, msg_id=msg_id,
            sender_id=sender_id, recipient_id=recipient_id,
            payload=b"", chunk_index=0, total_chunks=1, flags=flags,
        )]

    packets = []
    offset = 0
    # Initial guess: raw chunk size = max_chunk_payload (will compress smaller)
    raw_chunk_size = max_chunk_payload

    while offset < len(data):
        # Try progressively smaller raw chunks until compressed output fits
        for attempt_size in range(raw_chunk_size, 16, -16):
            raw_chunk = data[offset : offset + attempt_size]
            chunk_data, was_compressed = compress(raw_chunk)

            if encrypt_fn:
                chunk_data = encrypt_fn(chunk_data)

            if len(chunk_data) <= max_chunk_payload:
                flags = 0
                if was_compressed:
                    flags |= FLAG_COMPRESSED
                if encrypt_fn:
                    flags |= FLAG_ENCRYPTED
                packets.append(Packet(
                    msg_type=msg_type, msg_id=msg_id,
                    sender_id=sender_id, recipient_id=recipient_id,
                    payload=chunk_data, chunk_index=len(packets),
                    total_chunks=0,  # filled in below
                    flags=flags,
                ))
                offset += len(raw_chunk)
                # Use this attempt_size as starting point for next chunk
                raw_chunk_size = attempt_size
                break
        else:
            # Fallback: send uncompressed, truncated to fit
            raw_chunk = data[offset : offset + max_chunk_payload]
            if encrypt_fn:
                raw_chunk = encrypt_fn(raw_chunk)
            flags = FLAG_ENCRYPTED if encrypt_fn else 0
            packets.append(Packet(
                msg_type=msg_type, msg_id=msg_id,
                sender_id=sender_id, recipient_id=recipient_id,
                payload=raw_chunk[:max_chunk_payload],
                chunk_index=len(packets), total_chunks=0, flags=flags,
            ))
            offset += max_chunk_payload

    # Set total_chunks on all packets and chunked flag if multi-packet
    total = len(packets)
    for p in packets:
        p.total_chunks = total
        if total > 1:
            p.flags |= FLAG_CHUNKED

    return packets


# ── Reassembly ────────────────────────────────────────────────────────────

@dataclass
class ReassemblyBuffer:
    """Tracks incoming chunks for a single message, supports progressive rendering."""
    msg_id: int
    msg_type: int
    sender_id: int
    total_chunks: int
    chunks: dict[int, bytes] = field(default_factory=dict)
    started_at: float = field(default_factory=time.time)
    decrypt_fn: object = None  # Optional callable(bytes) -> bytes

    @property
    def is_complete(self) -> bool:
        return len(self.chunks) == self.total_chunks

    @property
    def is_expired(self) -> bool:
        return (time.time() - self.started_at) > CHUNK_TIMEOUT_S

    @property
    def received_count(self) -> int:
        return len(self.chunks)

    @property
    def progress(self) -> float:
        """0.0 to 1.0 completion."""
        if self.total_chunks == 0:
            return 1.0
        return len(self.chunks) / self.total_chunks

    def missing_indices(self) -> list[int]:
        """Return list of chunk indices not yet received."""
        return [i for i in range(self.total_chunks) if i not in self.chunks]

    def add_chunk(self, packet: Packet) -> Optional[bytes]:
        """Add a chunk. Returns the decompressed chunk content for progressive rendering,
        or None if this chunk was already received (duplicate)."""
        if packet.chunk_index in self.chunks:
            return None  # duplicate

        chunk_data = packet.payload

        # Decrypt if needed
        if (packet.flags & FLAG_ENCRYPTED) and self.decrypt_fn:
            chunk_data = self.decrypt_fn(chunk_data)

        # Decompress if needed
        if packet.flags & FLAG_COMPRESSED:
            chunk_data = decompress(chunk_data)

        self.chunks[packet.chunk_index] = chunk_data
        return chunk_data

    def reassemble(self) -> bytes:
        """Reassemble all chunks in order. Only call when is_complete is True."""
        if not self.is_complete:
            raise ValueError(f"Cannot reassemble: {self.received_count}/{self.total_chunks} chunks received")
        return b"".join(self.chunks[i] for i in range(self.total_chunks))


class Reassembler:
    """Manages reassembly buffers for multiple in-flight messages."""

    def __init__(self, decrypt_fn=None):
        self._buffers: dict[tuple[int, int], ReassemblyBuffer] = {}  # (msg_id, sender_id) -> buffer
        self.decrypt_fn = decrypt_fn

    def receive(self, packet: Packet) -> tuple[Optional[bytes], Optional[ReassemblyBuffer]]:
        """Process an incoming packet.

        Returns:
            (chunk_content, buffer) where:
            - chunk_content is the decompressed content of this chunk (for progressive rendering),
              or None if duplicate
            - buffer is the ReassemblyBuffer for this message (check buffer.is_complete)
        """
        key = (packet.msg_id, packet.sender_id)

        if key not in self._buffers:
            self._buffers[key] = ReassemblyBuffer(
                msg_id=packet.msg_id,
                msg_type=packet.msg_type,
                sender_id=packet.sender_id,
                total_chunks=packet.total_chunks,
                decrypt_fn=self.decrypt_fn,
            )

        buf = self._buffers[key]
        chunk_content = buf.add_chunk(packet)

        # Clean up completed buffers from tracking (caller should extract data first)
        if buf.is_complete:
            del self._buffers[key]

        return chunk_content, buf

    def cancel(self, msg_id: int, sender_id: int) -> None:
        """Cancel reassembly of a message (received CANCEL packet)."""
        key = (msg_id, sender_id)
        self._buffers.pop(key, None)

    def purge_expired(self) -> list[tuple[int, int]]:
        """Remove expired reassembly buffers. Returns list of (msg_id, sender_id) purged."""
        expired = [(k, b) for k, b in self._buffers.items() if b.is_expired]
        for key, _ in expired:
            del self._buffers[key]
        return [k for k, _ in expired]


# ── ACK helpers ───────────────────────────────────────────────────────────

# ACK payload format: [0] = ack_flags (bit0 = READ)
ACK_FLAG_READ = 0x01

def make_ack(msg_id: int, sender_id: int, recipient_id: int, read: bool = False) -> Packet:
    """Create an ACK packet for a received message."""
    ack_flags = ACK_FLAG_READ if read else 0x00
    return Packet(
        msg_type=MsgType.ACK,
        msg_id=msg_id,
        sender_id=sender_id,
        recipient_id=recipient_id,
        payload=bytes([ack_flags]),
    )


def make_cancel(msg_id: int, sender_id: int, recipient_id: int) -> Packet:
    """Create a CANCEL packet to abort a chunked transfer."""
    return Packet(
        msg_type=MsgType.CANCEL,
        msg_id=msg_id,
        sender_id=sender_id,
        recipient_id=recipient_id,
    )


def make_ping(sender_id: int, recipient_id: int = 0xFF) -> Packet:
    """Create a PING packet. recipient_id=0xFF means broadcast."""
    return Packet(
        msg_type=MsgType.PING,
        msg_id=next_msg_id(),
        sender_id=sender_id,
        recipient_id=recipient_id,
    )


def make_pong(sender_id: int, recipient_id: int, ping_msg_id: int) -> Packet:
    """Create a PONG response to a PING."""
    return Packet(
        msg_type=MsgType.PONG,
        msg_id=ping_msg_id,  # echo the ping's msg_id
        sender_id=sender_id,
        recipient_id=recipient_id,
    )


# ── High-level message builders ──────────────────────────────────────────

def build_text_message(
    text: str,
    sender_id: int,
    recipient_id: int,
    encrypt_fn=None,
) -> list[Packet]:
    """Build a TEXT chat message, chunked and compressed as needed."""
    return chunk_payload(
        data=text.encode("utf-8"),
        msg_type=MsgType.TEXT,
        msg_id=next_msg_id(),
        sender_id=sender_id,
        recipient_id=recipient_id,
        encrypt_fn=encrypt_fn,
    )


def build_llm_query(
    query: str,
    sender_id: int,
    recipient_id: int = 0,  # 0 = server
    encrypt_fn=None,
) -> list[Packet]:
    """Build an LLM_QUERY message."""
    return chunk_payload(
        data=query.encode("utf-8"),
        msg_type=MsgType.LLM_QUERY,
        msg_id=next_msg_id(),
        sender_id=sender_id,
        recipient_id=recipient_id,
        encrypt_fn=encrypt_fn,
    )


def build_llm_response(
    response_text: str,
    msg_id: int,
    sender_id: int,
    recipient_id: int,
    encrypt_fn=None,
) -> list[Packet]:
    """Build an LLM_RESP message (chunked, compressed for progressive rendering)."""
    return chunk_payload(
        data=response_text.encode("utf-8"),
        msg_type=MsgType.LLM_RESP,
        msg_id=msg_id,  # echo the query's msg_id so client can correlate
        sender_id=sender_id,
        recipient_id=recipient_id,
        encrypt_fn=encrypt_fn,
    )


def build_kb_search(
    query: str,
    sender_id: int,
    recipient_id: int = 0,
    encrypt_fn=None,
) -> list[Packet]:
    """Build a KB_SEARCH request."""
    return chunk_payload(
        data=query.encode("utf-8"),
        msg_type=MsgType.KB_SEARCH,
        msg_id=next_msg_id(),
        sender_id=sender_id,
        recipient_id=recipient_id,
        encrypt_fn=encrypt_fn,
    )


def build_kb_results(
    results_json: str,
    msg_id: int,
    sender_id: int,
    recipient_id: int,
    encrypt_fn=None,
) -> list[Packet]:
    """Build KB_RESULTS response (compressed JSON)."""
    return chunk_payload(
        data=results_json.encode("utf-8"),
        msg_type=MsgType.KB_RESULTS,
        msg_id=msg_id,
        sender_id=sender_id,
        recipient_id=recipient_id,
        encrypt_fn=encrypt_fn,
    )


def build_kb_fetch(
    article_path: str,
    sender_id: int,
    recipient_id: int = 0,
    encrypt_fn=None,
) -> list[Packet]:
    """Build a KB_FETCH request for a specific article."""
    return chunk_payload(
        data=article_path.encode("utf-8"),
        msg_type=MsgType.KB_FETCH,
        msg_id=next_msg_id(),
        sender_id=sender_id,
        recipient_id=recipient_id,
        encrypt_fn=encrypt_fn,
    )


def build_kb_article(
    article_text: str,
    msg_id: int,
    sender_id: int,
    recipient_id: int,
    encrypt_fn=None,
) -> list[Packet]:
    """Build KB_ARTICLE response (stripped text, chunked for progressive rendering)."""
    return chunk_payload(
        data=article_text.encode("utf-8"),
        msg_type=MsgType.KB_ARTICLE,
        msg_id=msg_id,
        sender_id=sender_id,
        recipient_id=recipient_id,
        encrypt_fn=encrypt_fn,
    )
