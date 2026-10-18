from mdvw import ipc


def test_frozen_executables_use_separate_instance_locks(monkeypatch, tmp_path):
    monkeypatch.setattr(ipc.config, "config_path", lambda: tmp_path / "config.json")
    monkeypatch.setattr(ipc.sys, "frozen", True, raising=False)
    monkeypatch.setattr(ipc.sys, "executable", str(tmp_path / "release-a" / "mdvw.exe"))
    first = ipc._lock_path()
    monkeypatch.setattr(ipc.sys, "executable", str(tmp_path / "release-b" / "mdvw.exe"))
    second = ipc._lock_path()

    assert first != second
    assert first.parent == second.parent == tmp_path
    assert first.name.startswith("instance-")
