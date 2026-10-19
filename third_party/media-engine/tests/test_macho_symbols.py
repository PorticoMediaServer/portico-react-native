import importlib.util
import pathlib
import struct
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location("media_verify", pathlib.Path(__file__).resolve().parents[1] / "verify.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


def image(entries):
    """Build a minimal LC_SYMTAB image using Apple's nlist_64 format."""
    strings = bytearray(b"\0")
    offsets = {}
    for name, kind, target in entries:
        for text in (name, target):
            if text and text not in offsets:
                offsets[text] = len(strings)
                strings.extend(text.encode() + b"\0")
    records = b"".join(struct.pack("<IBBHQ", offsets[name], kind | 1,
                                    1 if kind == 0x0E else 0, 0,
                                    offsets[target] if kind == 0x0A else 0)
                       for name, kind, target in entries)
    header = struct.pack("<IiiIIIII", 0xFEEDFACF, 0x0100000C, 0, 6, 1, 24, 0, 0)
    command = struct.pack("<IIIIII", 2, 24, 56, len(entries), 56 + len(records), len(strings))
    data = header + command + records + strings
    return verify.MachO(data, 0, len(data))


class MachOSymbols(unittest.TestCase):
    def test_import_alias_is_not_a_static_copy(self):
        macho = image([("_avcodec_open2", 0x0E, None),
                       ("_av_frame_alloc", 0x00, None),
                       ("_av_frame_alloc", 0x0A, "_av_frame_alloc"),
                       ("_prebound", 0x0C, None)])
        self.assertFalse(any(local for name, local in macho.symbols if name == "_av_frame_alloc"))
        self.assertIn(("_prebound", False), macho.symbols)
        report = Mock()
        verify.check_own_symbols(report, "fixture", "avcodec", macho.symbols)
        self.assertTrue(all(call.args[0] for call in report.check.call_args_list))

    def test_real_embedded_copy_still_fails(self):
        macho = image([("_avcodec_open2", 0x0E, None), ("_av_frame_alloc", 0x0E, None)])
        report = Mock()
        verify.check_own_symbols(report, "fixture", "avcodec", macho.symbols)
        failures = [call.args[1] for call in report.check.call_args_list if not call.args[0]]
        self.assertTrue(any("copy of libavutil" in message for message in failures))

    def test_local_alias_chains_are_definitions(self):
        macho = image([("_real", 0x0E, None), ("_absolute", 0x02, None),
                       ("_av_frame_alloc", 0x0A, "_alias"), ("_alias", 0x0A, "_real")])
        self.assertIn(("_av_frame_alloc", True), macho.symbols)
        self.assertIn(("_absolute", True), macho.symbols)


if __name__ == "__main__":
    unittest.main()
