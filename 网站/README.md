# 算法练习簿 · algo-practice

按专题学习、自由安排日期，记录每一次算法练习和每道题的 Markdown 笔记。内置 16 个专题、140 道题，支持题库管理、练习日历、复习参考、动画链接和专题文档。

本目录是独立的网站项目。无后端、无运行时第三方依赖；构建只使用 Python 3 标准库，不需要安装 npm 依赖。

## 构建与使用

进入本目录（包含 `build.py` 的目录）后执行：

```sh
python3 build.py
```

打开生成的 `dist/index.html` 即可使用，也可以将 `dist/` 发布到 Nginx。部署步骤见 [部署说明](deploy/README.md)。构建结果不纳入 Git。

如果一直通过另一个固定位置的 HTML 使用网站，可显式更新那个文件，保持原来的浏览器存储路径：

```sh
python3 build.py --local-html /你的文件目录/刷题工作台.html
```

`--local-html` 的相对路径按终端当前目录解析；不指定它时，构建只写入本项目的 `dist/`。旧的 `--web` 命令仍可使用，效果与默认构建相同。

## 运行测试

在本目录执行：

```sh
node --test tests/*.test.js
python3 -B -m unittest discover -s tests -p 'test_*.py'
```

Node.js 测试覆盖日期、题库管理、数据备份、学习推荐、Markdown 和界面交互；Python 测试验证独立构建及本地文件输出位置。

## 目录结构

| 路径 | 内容 |
| --- | --- |
| `src/shell.html` | HTML 模板 |
| `src/app.css`、`src/markdown.css` | 界面与 Markdown 样式 |
| `src/core.js` | 数据结构、校验、迁移与学习逻辑 |
| `src/ui.js`、`src/manager.js` | 页面交互与题库管理 |
| `src/date.js`、`src/select.js` | 日期与选择器组件 |
| `src/markdown.js`、`src/editor.js` | Markdown 渲染与编辑辅助 |
| `src/catalog.json` | 内置默认题库 |
| `tests/` | 自动化测试 |
| `build.py` | 单文件构建脚本 |
| `deploy/` | Nginx 配置示例与部署说明 |
| `dist/` | 生成的发布目录 |

## 数据与备份

题库调整、练习记录、Markdown 笔记、动画链接和专题文档保存在当前浏览器的 `localStorage` 中，不会写回源码或服务器。个人数据不包含在仓库中。

切换浏览器、设备、域名或 HTML 文件位置前，先从“备份与设置”导出完整 JSON，再到目标页面导入。导入会替换目标页面的数据。多设备自动同步需要另行开发后端。
