#!/usr/bin/env python3
"""Build the offline, single-file study planner using only Python's stdlib."""

from pathlib import Path
import argparse
import base64
import json
import re


WEBSITE_DIR = Path(__file__).resolve().parent
SOURCE_DIR = WEBSITE_DIR / "src"


def read(name):
    return (SOURCE_DIR / name).read_text(encoding="utf-8")


def validate_catalog_group(categories, problems, label):
    category_ids = [category["id"] for category in categories]
    problem_ids = [problem["id"] for problem in problems]
    if len(category_ids) != len(set(category_ids)):
        raise ValueError(f"{label}存在重复专题 ID")
    if len(problem_ids) != len(set(problem_ids)):
        raise ValueError(f"{label}存在重复题号")
    if set(problem_ids) & {"54", "48", "73", "240"}:
        raise ValueError(f"{label}包含已排除的矩阵模拟题")
    patterns = {}
    references = []
    for category in categories:
        for pattern in category["patterns"]:
            if pattern["id"] in patterns:
                raise ValueError(f"{label}题型 ID 重复")
            patterns[pattern["id"]] = (category["id"], pattern)
            references.extend(pattern["coreIds"] + pattern["extraIds"])
    if sorted(references) != sorted(problem_ids):
        raise ValueError(f"{label}题目与题型归属不一致")
    for problem in problems:
        if problem["categoryId"] not in category_ids or problem["patternId"] not in patterns:
            raise ValueError(f"{label}题目包含无效的题型归属")
        if problem["role"] not in ("core", "extra"):
            raise ValueError(f"{label}题目主线/变体标记无效")
        category_id, pattern = patterns[problem["patternId"]]
        role_field = "coreIds" if problem["role"] == "core" else "extraIds"
        if category_id != problem["categoryId"] or problem["id"] not in pattern[role_field]:
            raise ValueError(f"{label}题目的专题或主线/变体归属不一致")
    return set(category_ids), set(problem_ids), set(patterns)


def validate_catalog(catalog):
    active = validate_catalog_group(catalog["categories"], catalog["problems"], "当前题库")
    retired = validate_catalog_group(catalog.get("retiredCategories", []), catalog.get("retiredProblems", []), "兼容元数据")
    for current_ids, retired_ids in zip(active, retired):
        if current_ids & retired_ids:
            raise ValueError("当前题库与兼容元数据存在重复 ID")


def main():
    parser = argparse.ArgumentParser(description="生成独立的离线 HTML 与 Nginx 静态站点")
    parser.add_argument("--web", action="store_true", help="兼容旧命令；默认已生成 dist/index.html")
    parser.add_argument("--local-html", type=Path, help="额外更新指定的本地 HTML 文件；相对路径按当前工作目录解析")
    args = parser.parse_args()
    shell = read("shell.html")
    favicon = (SOURCE_DIR / "favicon.ico").read_bytes()
    favicon_url = "data:image/x-icon;base64," + base64.b64encode(favicon).decode("ascii")
    style = read("app.css") + "\n" + read("markdown.css")
    core = read("core.js")
    picker = read("select.js")
    date_picker = read("date.js")
    markdown = read("markdown.js")
    editor = read("editor.js")
    manager = read("manager.js")
    ui = read("ui.js")
    catalog = json.loads(read("catalog.json"))
    validate_catalog(catalog)
    # An HTML parser ends a script element even when this spelling occurs inside
    # a JS string or comment. Fail explicitly instead of altering JS semantics.
    for name, script in (("core.js", core), ("select.js", picker), ("date.js", date_picker), ("markdown.js", markdown), ("editor.js", editor), ("manager.js", manager), ("ui.js", ui)):
        if re.search(r"</script", script, flags=re.IGNORECASE):
            raise ValueError(f"{name} 包含 HTML 脚本结束标记，请在源码中拆开或转义该字面值")
    if re.search(r"</style", style, flags=re.IGNORECASE):
        raise ValueError("app.css 包含 HTML 样式结束标记")
    if re.search(r"@import\b", style, flags=re.IGNORECASE):
        raise ValueError("样式不允许使用外部 @import")
    # Escaping '<' makes any user-facing text, including a closing script tag,
    # harmless when the catalog is embedded in an application/json element.
    catalog_json = json.dumps(catalog, ensure_ascii=False, separators=(",", ":"))
    catalog_json = catalog_json.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    replacements = {"{{FAVICON}}": favicon_url, "{{STYLE}}": style, "{{CATALOG}}": catalog_json, "{{CORE}}": core, "{{UI}}": "\n".join((picker, date_picker, markdown, editor, manager, ui))}
    for token in replacements:
        if shell.count(token) != 1:
            raise ValueError(f"shell.html 必须且只能包含一次 {token}")
    # Match only original template tokens: injected sources cannot be interpreted
    # as another template substitution.
    output = re.sub(r"\{\{(?:FAVICON|STYLE|CATALOG|CORE|UI)\}\}", lambda match: replacements[match.group(0)], shell)
    if re.search(r"<script\b[^>]*\bsrc\s*=", output, flags=re.IGNORECASE):
        raise ValueError("单文件应用不允许依赖外部脚本")
    if re.search(r"<link\b[^>]*\brel\s*=\s*['\"]?stylesheet\b", output, flags=re.IGNORECASE):
        raise ValueError("单文件应用不允许依赖外部样式表")
    if re.search(r"url\(\s*['\"]?(?:https?:)?//", style, flags=re.IGNORECASE):
        raise ValueError("单文件应用不允许引用远程样式资源")
    web_output = WEBSITE_DIR / "dist" / "index.html"
    web_output.parent.mkdir(parents=True, exist_ok=True)
    web_output.write_text(output, encoding="utf-8")
    (web_output.parent / "favicon.ico").write_bytes(favicon)
    print(f"已生成 {web_output}（{len(catalog['categories'])} 类，{len(catalog['problems'])} 题）")
    if args.local_html:
        local_output = args.local_html.resolve()
        local_output.write_text(output, encoding="utf-8")
        print(f"已更新本地 HTML {local_output}")


if __name__ == "__main__":
    main()
