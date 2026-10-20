# 硇洲岛田野图集 · Naozhou Field Atlas

黑白矢量田野调查地图，包含村庄、道路、聚落、行政范围示意、调查点位和神明记录。

## 本地使用

Windows 双击 `打开地图.cmd`，访问 `http://127.0.0.1:8765/`，保持服务窗口开启。
本地版继续使用 PowerShell 服务，记录保存在本机 `data/` 文件夹。
新克隆的仓库不含私人调查存档；本地首次启动需准备自己的 `data/field-points.geojson` 和 `data/village-faith.json`，或继续使用已有工作文件夹。

## Netlify 部署

1. 在 Netlify 导入本 GitHub 仓库，生产分支选择 `main`。
2. 构建命令 `npm run build`，发布目录 `dist`，函数目录 `netlify/functions`，配置已写入 `netlify.toml`。
3. 添加环境变量 `NAOZHOU_EDITOR_PASSWORD`，使用至少 20 位的独立口令，作用域包含 Functions。口令不可提交到 GitHub。
4. 部署完成后，进入地图「数据 → 登录编辑」输入口令，即可保存至云端。

云端资料使用 Netlify Blobs 的站点存储，重新部署不会清空记录。记录保留现有 ID、坐标和版本冲突检查。
地图与在线录入的资料公开可读；只有编辑者可写。口令仅保存在 Netlify 环境变量中，浏览器使用 12 小时的 HttpOnly 会话。
本地文件与云端存储是两份资料，不会自动双向同步。可用页面的 GeoJSON / 信仰备份导入导出迁移。
`netlify/seed/` 保存首次上线的公开资料；云端已有记录后，后续发布不会用种子资料覆盖它们。

后续修改源码后提交、推送到 `main`，Netlify 自动重新部署。在线新增的调查资料不会自动变成 Git 提交。

## 开发

```sh
npm ci
npm test
npm run build
```

主要文件：`index.html`、`map.css`、`map-app.js`、`faith-records.js`、`map-data.js`。
`cloud-access.js` 只在 Netlify 构建中启用；`netlify/functions/` 提供 `/api/points`、`/api/faith` 和 `/api/auth`。
发布目录仅包含运行所需文件，本地备份、访谈存档和工作截图不上传到网站。

## 地图资料与署名

海岸线、道路、聚落等来自 [OpenStreetMap](https://www.openstreetmap.org/copyright)，适用 ODbL；部分地名来自 [GeoNames](https://www.geonames.org/)，适用 CC BY 4.0。补充地点及聚落采用调查者核对资料，来源保留在地图数据中。行政斜线区域为陆地范围示意，不能作为法定村界。
本地界面图标来自 Lucide，许可见 `work/lucide-atlas-license.txt`。地图保留各数据来源署名。
