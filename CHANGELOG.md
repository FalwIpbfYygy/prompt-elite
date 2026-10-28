# Changelog — prompt-elite

> 项目级变更日志。**约定：每次改动本项目（代码 / 配置 / 文档），都在这里追加一条记录**——日期 + 改了什么 + 涉及文件。
> 格式：日期标题下用 `- [类型] 简述（文件）`，类型取 `新增` / `修改` / `修复` / `文档`。
> 新增条目放在最上方（最新在上）。

## 2026-10-28

- [修改] 压缩卡片高度：`.card .preview` 预览行数 5→3、行高 1.6→1.55；`.grid` 取消等高拉伸（`align-items: stretch`→`start`），消除卡片底部大片留白（`public/style.css`）。
- [新增] 隐私隔离：新增 `.gitignore`（忽略 `.env` / `config.json` / `data/prompts.json` 等）、精简 `.env`、`config.example.json`（无密钥模板）；删除明文 `config.json`；`server.js` 增加零依赖 `loadDotEnv()`，配置优先级 `.env/环境变量 > config.json > config.example.json`。
- [修改] 需求砍半：「量化回测审计与优化任务」两份重复副本（纯文本 trade + markdown 通用/AI生成）重写为约一半长度，保留全部核心约束——先审计后改、禁造假/未来函数、分阶段确认、可复现、不碰实盘（`data/prompts.json`）。
- [新增] 项目文档：`README.md`（启动方式 + `.env` 变量清单）、`.env.example`（无密钥模板）。
- [文档] 上传至 GitHub `FalwIpbfYygy/prompt-elite`，隐私文件（`.env` / `config.json` / `prompts.json`）全程未入库（红线）。
- [修改] `.gitignore` 增补 IDE 配置忽略：`.idea/`、`.vscode/`，保持仓库只含功能文件。
- [新增] 本文件 `CHANGELOG.md`：建立项目级变更留痕机制。
