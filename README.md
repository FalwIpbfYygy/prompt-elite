# Prompt Elite

零依赖的本地提示词（Prompt）管理工具。一个 Node.js 单文件服务，提供：

- 提示词 CRUD（标题 / 内容 / 标签 / 分类 / 收藏 / 版本历史）
- 静态托管前端（卡片式浏览、搜索、筛选、Markdown 渲染）
- 内置 LLM 流式代理（把对话请求转发到 OpenAI 兼容接口，密钥只留服务端，避免浏览器 CORS 与泄露）

> 设计为纯本地、单机使用。数据存在本地 JSON 文件，不依赖任何数据库或第三方服务。

## 目录结构

```
prompt-elite/
├── server.js            # 零依赖 Node.js 服务（静态托管 + API + LLM 代理）
├── config.example.json  # 配置模板（已提交，无密钥）
├── .env.example         # 环境变量模板（已提交，无密钥）→ 复制为 .env 后填真实值
├── public/              # 前端：index.html / app.js / style.css
├── data/                # 运行时生成，存放 prompts.json（已在 .gitignore 中）
├── .env                 # 本地私密配置（已被 .gitignore 忽略，勿提交）
└── .gitignore
```

## 环境要求

- Node.js ≥ 14（**无需** `npm install`，零依赖）

## 启动方式

```bash
# 1. 准备私密配置（首次使用）
cp .env.example .env
# 编辑 .env，填入你的 DASHSCOPE_API_KEY 等（见下方变量清单）

# 2. 启动
node server.js
# 或自定义端口
PORT=9000 node server.js
```

启动后访问 http://localhost:8787 （或你设置的端口）。首次运行会自动创建 `data/prompts.json`。

## .env 变量清单

基于已提交的 `.env.example` 复制为 `.env` 后填写。所有变量均可选，缺省时有合理默认值。

| 变量 | 必填 | 说明 | 默认值 |
|------|------|------|--------|
| `DASHSCOPE_API_KEY` | 否* | LLM 服务密钥（阿里云百炼 / DashScope / 任意 OpenAI 兼容端点）。不填则 `/api/chat` 不可用，但不影响本地提示词管理。 | 无 |
| `PRIVATE_BASE_URL` | 否 | 私有兼容端点 base，如阿里云 MAAS `https://<workspace>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。 | 无 |
| `COMMON_BASE_URL` | 否 | 公共兼容端点 base。 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `DEFAULT_MODEL` | 否 | 默认模型名。 | `deepseek-v4.1-flash` |
| `PORT` | 否 | 服务端口。 | `8787` |
| `TIMEOUT_MS` | 否 | 上游请求超时（毫秒）。 | `120000` |

\* 仅当你要使用内置的「AI 优化 / 迭代 / 翻译」功能时才需要填；纯本地管理提示词不需要。

**配置优先级**：`.env` / 环境变量 > `config.json` > `config.example.json`。

## 隐私说明（重要）

本项目刻意把隐私隔离在版本库之外：

- `.env`（真实密钥）、`config.json`（若存在）、`data/prompts.json`（你的提示词）均在 `.gitignore` 中，**不会被提交**。
- 仓库只保留功能代码与 `config.example.json` / `.env.example` 模板。
- 不要把 `.env` 提交到任何公开仓库。

## API 速览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查，返回默认模型 |
| GET / POST | `/api/prompts` | 列出 / 新建提示词 |
| PUT / PATCH / DELETE | `/api/prompts/:id` | 更新 / 删除单条 |
| POST | `/api/prompts/import` | 导入（replace / merge） |
| GET | `/api/prompts/export` | 导出 JSON |
| GET | `/api/stats` | 分类统计 |
| POST | `/api/chat` | LLM 流式代理 |

## License

自用工具，按需取用。
