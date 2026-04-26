"""OMP opcode constants and dispatch table.

Mirrors docs/05-OMP-PROTOCOL.md §3. The Python and JS sides MUST agree
on opcode numbers — Sprint 2 ships them as constants on both sides;
the test suite asserts agreement via shared fixture vectors.

Opcode space, by range:
  0x00-0x0F   Protocol control
  0x10-0x2F   Comms (mail, boards, mesh)
  0x30-0x4F   Knowledge (LLM, library)
  0x50-0x6F   Medical
  0x70-0x8F   Navigation
  0x90-0xAF   Power, System
  0xB0-0xCF   Log, Inventory, Timeline
  0xD0-0xEF   Recreation, Signal
  0xF0-0xFF   Reserved + plugin range

The high bit (0x80) is RESERVED to mark fragmented packets — actual
opcodes never set it. Implementations MUST mask with 0x7F when
extracting the opcode from a wire byte (codec.py does this).
"""

from enum import IntEnum


class Op(IntEnum):
    # Protocol control ------------------------------------------------
    HELLO          = 0x00
    HELLO_ACK      = 0x01
    ACK            = 0x02
    NACK           = 0x03
    PING           = 0x04
    PONG           = 0x05
    ERROR          = 0x06
    FRAG_REQ       = 0x07
    DICT_HASH      = 0x08
    DICT_FETCH     = 0x09
    SYNC_HELLO     = 0x0A
    TIME_SYNC      = 0x0B
    TIME_SYNC_RESP = 0x0C
    SUBSCRIBE      = 0x0D
    UNSUBSCRIBE    = 0x0E
    PUSH           = 0x0F

    # Comms (selection — full table per spec, fleshed out as Sprint 6 lands)
    INBOX_HEADERS    = 0x10
    MESSAGE_FETCH    = 0x11
    MESSAGE_SEND     = 0x12
    MESSAGE_MARK_READ = 0x13
    BOARD_LIST       = 0x19
    NET_NODES        = 0x20

    # Knowledge
    LLM_QUERY = 0x30
    LLM_TOKEN = 0x31

    # Power & System
    POWER_NOW       = 0x90
    POWER_HISTORY   = 0x91
    SYS_STATUS      = 0xA0
    SYS_PIN_VERIFY  = 0xA4

    # The full table is large; modules add their entries during their
    # sprint. Test vectors in tests/unit/test_omp_codec.py exercise
    # at least one from each range to verify the format is solid.


#: Set of opcodes that REQUIRE an ACK reply when sent C→S
ACK_REQUIRED = frozenset({
    Op.MESSAGE_SEND,        # comms.send
    # waypoint_new, board_post, etc. added as their modules land
})


def is_fragment(byte: int) -> bool:
    """Return True if the opcode byte has the fragment marker (high bit)."""
    return bool(byte & 0x80)


def real_op(byte: int) -> int:
    """Strip the fragment marker; returns the actual opcode."""
    return byte & 0x7F
