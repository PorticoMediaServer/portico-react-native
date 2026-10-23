"""The built decoder inventory must retain the requested native music formats."""
import importlib.util
import json
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("media_engine_verify", HERE / "verify.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)

# FFmpeg names both Musepack generations separately; neither implies the other.
MUSIC = ("ac4", "ape", "wavpack", "tta", "mpc7", "mpc8", "dsd_lsbf", "dsd_msbf", "dsd_lsbf_planar", "dsd_msbf_planar")


class FfmpegMusicInventoryTest(unittest.TestCase):
    def check_inventory(self, missing=None):
        with tempfile.TemporaryDirectory(prefix="ffmpeg-features-") as directory:
            meta = pathlib.Path(directory)
            (meta / "ffmpeg-config.h").write_text('#define FFMPEG_LICENSE "GPL version 3 or later"\n#define FFMPEG_CONFIGURATION "--enable-gpl --enable-version3"\n')
            source = json.loads((HERE.parent / "ffmpeg/sources.lock.json").read_text())["ffmpeg"]
            (meta / "ffmpeg-source-receipt.json").write_text(json.dumps({"sourceCommit": source["commit"], "sourceSha256": source["sha256"], "patches": source["patches"]}))
            inventory = {kind: set(names) for kind, names in verify.REQUIRED.items()}
            for kind, names in verify.REQUIRED_PLATFORM.get("android", {}).items():
                inventory.setdefault(kind, set()).update(names)
            inventory["decoder"].update(MUSIC)
            if missing:
                inventory["decoder"].discard(missing)
            (meta / "ffmpeg-config_components.h").write_text("\n".join(
                f"#define CONFIG_{name.upper()}_{kind.upper()} 1"
                for kind, names in inventory.items() for name in sorted(names)))
            report = verify.Report()
            verify.check_ffmpeg_meta(report, meta, "android", "android/test", {})
            return report.failures

    def test_complete_music_inventory_is_accepted(self):
        self.assertEqual([], self.check_inventory())

    def test_each_requested_decoder_is_required_independently(self):
        for decoder in MUSIC:
            with self.subTest(decoder=decoder):
                self.assertIn(f"android/test: FFmpeg lacks decoders {decoder}", self.check_inventory(decoder))


if __name__ == "__main__":
    unittest.main()
