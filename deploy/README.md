# Nginx 部署与数据迁移

工作台是单文件静态网站。Nginx 只负责提供页面，浏览器继续保存学习数据；不需要数据库、Node 服务或接口改造。

## 1. 在本地生成发布文件

在项目根目录执行：

```sh
node --test 刷题工作台源码/*.test.js
python3 刷题工作台源码/build.py --web
```

发布产物只有 `dist/index.html`。可以将它放在独立域名根目录，也可以放在子目录中，例如 `/study/index.html`。专题文档使用页面的 `#document=...` 地址打开，不需要配置额外的服务端路由。

## 2. 上传到服务器

以下命令以已安装 Nginx、使用 systemd 的 Linux 服务器为例。将 `user@your-server` 替换为自己的 SSH 目标。在本地上传：

```sh
scp dist/index.html user@your-server:/tmp/algo-practice-index.html
```

然后在服务器执行：

```sh
sudo mkdir -p /var/www/algo-practice
sudo install -m 644 /tmp/algo-practice-index.html /var/www/algo-practice/index.html
```

后续更新时重新构建并替换这个文件。上传 HTML 不会修改用户浏览器里已保存的练习记录。

## 3. 配置 Nginx

将 [nginx.conf](nginx.conf) 示例中的 `server_name` 改为自己的域名，并按实际目录修改 `root`。把修改后的文件放入服务器的 `/etc/nginx/conf.d/algo-practice.conf`，确认主配置包含该目录，且没有相同域名的重复站点配置。

```sh
sudo nginx -t
sudo systemctl reload nginx
```

示例是 HTTP 站点。若已有 HTTPS 站点，将 `root`、`index`、`charset` 与 `location` 配置合并到对应的 HTTPS `server` 中，沿用其证书配置。建议确定最终 HTTPS 地址后再导入个人数据，避免重复迁移。

只把 `dist/` 作为发布目录，不要把整个 Git 仓库、`.git/` 或个人备份放进站点根目录。页面采用 `no-cache`，浏览器可以保存副本，但会重新验证更新。静态文件的 `root`、`index` 行为见 [Nginx 官方指南](https://nginx.org/en/docs/beginners_guide.html)。

## 4. 迁移已有学习数据

1. 在原来打开的本地 HTML 中，进入“备份与设置”，导出完整 JSON 并妥善保存。
2. 在同一浏览器中打开最终网站地址，例如 `https://study.example.com/`。
3. 进入“备份与设置”，选择刚导出的 JSON，核对恢复预览后确认。导入会整份替换目标页面的数据。
4. 核对题库调整、笔记、实际练习、安排和专题文档，确认无误后再使用新地址。

`localStorage` 按来源隔离，协议、域名和端口变化都会影响数据所属空间；`file://` 的行为还取决于浏览器。访问新地址时没有原数据，不代表旧数据被删除。参见 [MDN localStorage 说明](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)。

## 5. 部署后的边界

- 新增、编辑、删除题目依然只改变当前浏览器的数据，不会自动更新 GitHub 或服务器上的默认题库。
- 不同浏览器、不同设备不会自动同步；网站管理员也无法通过 Nginx 直接读取浏览器里的学习记录。
- 更新内置题库时，浏览器里的题库覆盖与删除标记继续优先，已有笔记与练习按稳定题号关联。
- 清理浏览器数据前先导出 JSON。完整同步、登录和服务器备份需要后端 API、用户鉴权与数据库，属于后续功能。

本目录提供部署示例；当前尚未连接或修改任何云服务器。
