from __future__ import annotations

import io
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
HELPER = REPO_ROOT / "scripts" / "ops" / "supabase-restore-safety.py"


class RestoreSafetyTests(unittest.TestCase):
    def run_helper(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(HELPER), *args],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_extracts_valid_archive_with_internal_hard_link(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            archive = root_path / "valid.tgz"
            destination = root_path / "extract"
            destination.mkdir()

            with tarfile.open(archive, "w:gz") as bundle:
                storage = tarfile.TarInfo("storage/")
                storage.type = tarfile.DIRTYPE
                bundle.addfile(storage)

                payload = b"safe-media"
                original = tarfile.TarInfo("storage/original.bin")
                original.size = len(payload)
                bundle.addfile(original, io.BytesIO(payload))

                linked = tarfile.TarInfo("storage/copy.bin")
                linked.type = tarfile.LNKTYPE
                linked.linkname = "storage/original.bin"
                bundle.addfile(linked)

            result = self.run_helper("extract-storage", str(archive), str(destination))

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((destination / "storage" / "copy.bin").read_bytes(), b"safe-media")

    def test_rejects_hard_link_target_outside_storage_root(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            archive = root_path / "escape.tgz"
            destination = root_path / "extract"
            destination.mkdir()

            with tarfile.open(archive, "w:gz") as bundle:
                storage = tarfile.TarInfo("storage/")
                storage.type = tarfile.DIRTYPE
                bundle.addfile(storage)

                linked = tarfile.TarInfo("storage/escape")
                linked.type = tarfile.LNKTYPE
                linked.linkname = "outside"
                bundle.addfile(linked)

            result = self.run_helper("extract-storage", str(archive), str(destination))

            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((destination / "storage" / "escape").exists())
            self.assertNotIn("outside", result.stderr)

    def test_filters_existing_simple_roles_without_changing_role_attributes(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            source = root_path / "roles.sql"
            existing = root_path / "existing.txt"
            output = root_path / "filtered.sql"
            source.write_text(
                "CREATE ROLE postgres;\n"
                "ALTER ROLE postgres WITH SUPERUSER LOGIN;\n"
                "CREATE ROLE app_worker;\n"
                "ALTER ROLE app_worker WITH NOSUPERUSER NOLOGIN;\n",
                encoding="utf-8",
            )
            existing.write_text("postgres\n", encoding="utf-8")

            result = self.run_helper(
                "filter-roles",
                str(source),
                str(existing),
                str(output),
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            filtered = output.read_text(encoding="utf-8")
            self.assertNotIn("CREATE ROLE postgres;", filtered)
            self.assertIn("ALTER ROLE postgres WITH SUPERUSER LOGIN;", filtered)
            self.assertIn("CREATE ROLE app_worker;", filtered)
            self.assertIn("ALTER ROLE app_worker WITH NOSUPERUSER NOLOGIN;", filtered)


if __name__ == "__main__":
    unittest.main()
