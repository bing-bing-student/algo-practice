"""Check that the published website builds without the surrounding personal workspace."""

from pathlib import Path
import base64
import re
import shutil
import subprocess
import sys
import tempfile
import unittest


WEBSITE_DIR = Path(__file__).resolve().parents[1]


class StandaloneBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.website = self.root / "website"
        self.website.mkdir()
        shutil.copytree(WEBSITE_DIR / "src", self.website / "src")
        shutil.copyfile(WEBSITE_DIR / "build.py", self.website / "build.py")
        self.cwd = self.root / "working-directory"
        self.cwd.mkdir()

    def build(self, *args):
        result = subprocess.run(
            [sys.executable, str(self.website / "build.py"), *args],
            cwd=self.cwd, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return (self.website / "dist" / "index.html").read_bytes()

    def test_default_build_is_self_contained_and_web_alias_is_compatible(self):
        output = self.build()
        self.assertIn("算法练习簿".encode(), output)
        favicon = (self.website / "src" / "favicon.ico").read_bytes()
        self.assertEqual((self.website / "dist" / "favicon.ico").read_bytes(), favicon)
        icon_link = re.search(rb'<link rel="icon" type="image/x-icon" href="data:image/x-icon;base64,([^"]+)">', output)
        self.assertIsNotNone(icon_link, "本地 HTML 应包含无需外部文件的图标")
        self.assertEqual(base64.b64decode(icon_link.group(1), validate=True), favicon)
        self.assertEqual(list(self.root.glob("*.html")), [])
        self.assertEqual(list(self.cwd.glob("*.html")), [])
        self.assertEqual(output, self.build("--web"))

    def test_local_html_is_updated_only_at_the_explicit_path(self):
        local = self.cwd / "刷题工作台.html"
        local.write_text("old content")
        output = self.build("--local-html", local.name)
        self.assertEqual(local.read_bytes(), output)
        self.assertEqual(list(self.root.glob("*.html")), [])


if __name__ == "__main__":
    unittest.main()
