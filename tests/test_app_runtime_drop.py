"""Dropped Windows files reach the document opener with their full path."""

import json
from unittest.mock import MagicMock

from webview.event import Event

from mdvw import app_runtime


def test_window_allows_text_selection(tmp_path, monkeypatch):
    create_window = MagicMock()
    monkeypatch.setattr(app_runtime.webview, "create_window", create_window)

    app_runtime._create_window(tmp_path / "index.html", MagicMock(), "mdvw")

    assert create_window.call_args.kwargs["text_select"] is True


def test_launch_file_sets_file_tree_root(tmp_path):
    folder = tmp_path / "notes"
    folder.mkdir()
    note = folder / "note.md"
    note.write_text("# Note", encoding="utf-8")

    file, root = app_runtime._restore_launch_file(note)

    assert file == note
    assert root == folder


def test_drop_handler_forwards_markdown_path(tmp_path, monkeypatch):
    window = MagicMock()
    window.events.loaded = Event(window)
    api = MagicMock()
    monkeypatch.setattr(app_runtime.secrets, "token_urlsafe", lambda length: "one-time-token")
    for name in (
        "_set_window_icon",
        "_bring_to_front",
        "_maybe_prompt_association",
    ):
        monkeypatch.setattr(app_runtime, name, MagicMock())
    monkeypatch.setattr(app_runtime, "_find_hwnd_by_title", lambda title: None)

    app_runtime._attach_loaded_handler(window, api, "mdvw")
    window.events.loaded._items[0]()
    drop_handler = window.dom.document.on.call_args.args[1]
    note = str(tmp_path / "dropped.md")
    drop_handler({"dataTransfer": {"files": [
        {"name": "ignored.txt", "pywebviewFullPath": str(tmp_path / "ignored.txt")},
        {"name": "dropped.md", "pywebviewFullPath": note},
    ]}})

    window.evaluate_js.assert_called_once_with(
        f"window.mdvwOpenDroppedFile({json.dumps('one-time-token')}, {json.dumps('dropped.md')})"
    )
    assert api._drop_candidate == ("one-time-token", tmp_path / "dropped.md")
