# MD阅读器

基于 [ThomasRohde/mdvw](https://github.com/ThomasRohde/mdvw) 的 Windows Markdown 阅读器。此 Fork 面向本地 `.md` 文件阅读，保留离线渲染能力，并调整为只读界面。

## 功能

- 双击程序或关联的 `.md` 文件打开；支持把 `.md`、`.markdown` 文件拖入窗口。
- 单实例、多页签；左侧显示当前目录的 Markdown 文件和目录结构，可隐藏侧栏、调整文件列表与大纲的上下位置。
- 支持 GitHub 风格表格、代码高亮、数学公式、Mermaid 图及大纲导航。
- 正文可选择和复制。表格中按住 Ctrl 点击可选择整列，按住 Ctrl 拖动可选择多列或部分行；拖到视图边缘时自动滚动。Ctrl+C 复制为制表符分隔文本。
- Ctrl++ / Ctrl+- 调整缩放，Ctrl+0 恢复 100%；缩放比例在下次启动时恢复。
- Ctrl+Tab 切换页签，Alt+← / Alt+→ 在访问过的文件间导航。
- 关闭窗口即退出程序。文件改变时自动刷新阅读内容。

## 使用

下载或构建 Windows 便携版后，运行 `MD阅读器/MD阅读器.exe`。程序无需安装，可通过工具栏或文件拖放打开 Markdown 文件。

从源码运行需要 Python 3.13+：

```bash
python -m pip install -e .
python -m mdvw path/to/file.md
```

构建 Windows 便携版：

```bash
python -m pip install pyinstaller
python -m PyInstaller --noconfirm packaging/mdvw.spec
```

生成目录为 `dist/MD阅读器/`。构建时请保留整个目录，不要单独复制 exe。

## 开发验证

```bash
python -m pip install -e ".[dev]"
pytest -q
ruff check src tests scripts
python scripts/fetch_vendor.py --verify
```

## 来源与许可

本项目 Fork 自 [mdvw](https://github.com/ThomasRohde/mdvw)，保留原项目的 [MIT 许可](LICENSE)。KaTeX、Mermaid、highlight.js 等随项目打包的第三方资源遵循各自许可。
