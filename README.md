# Silian · 思维导图式 AI 聊天应用

> 把"直线型 AI 对话"升级为"可视化、可回溯、可分支"的**思维导图式对话**。

Silian 是一个基于思维导图的 AI 聊天应用：每一轮对话都是一个节点，用户可以在任意历史节点上"分叉"，沿不同方向继续提问，从而摆脱传统聊天工具中"上下文越长越难回溯"的痛点。适合学术研究、方案策划、问题拆解、头脑风暴等需要发散与结构化思考的场景。

---

## ✨ 核心特性

- 🧠 **思维导图式对话**：基于 [MindElixir](https://github.com/SSShooter/mind-elixir-core) 渲染，每条消息即一个节点，支持自由分支
- 🔀 **任意节点续聊**：在历史任意节点上继续提问，无需被线性上下文束缚
- 🎯 **动态上下文计算（核心能力）**：每次提问时，后端**实时**沿节点树回溯当前节点到根节点的路径，动态构建发送给大模型的上下文 —— 不再受"固定对话窗口"限制，分叉到哪里就以哪条路径为准，彻底避免无关分支的污染
- 📏 **基于 Token 的精准上下文压缩**：使用 `tiktoken` 精确计量 token，超出预算时按可配置策略自动压缩（`recent_n` / `summary` / `hybrid`），并保留首条消息维持话题锚点
- 🧩 **多分支上下文合并**：支持同时从多个节点抽取上下文、按时间戳排序去重合并，便于跨分支综合提问
- 🗂️ **会话与分组管理**：支持多会话、会话置顶、重命名、分组展示
- 🤖 **多模型兼容**：内置 OpenAI 兼容协议，可对接 OpenAI、智谱 GLM、DeepSeek、月之暗面、字节豆包、百度文心一言等
- 💾 **本地优先存储**：会话数据以节点树形式存储于本地 `data/` 目录，无需数据库
- ⚡ **轻量后端**：基于 FastAPI，零运维门槛，单机即可运行

---

## 🛠️ 技术栈

| 层 | 技术 |
|---|---|
| 后端框架 | [FastAPI](https://fastapi.tiangolo.com/) + Uvicorn |
| AI 接入 | OpenAI SDK（兼容协议），支持多 Provider 切换 |
| 前端 | 原生 HTML / CSS / JavaScript（无构建步骤） |
| 思维导图渲染 | [MindElixir](https://github.com/SSShooter/mind-elixir-core) |
| 模板引擎 | Jinja2 |
| 配置管理 | python-dotenv + pydantic-settings |
| 存储 | 本地文件（JSON）|

---

## 🚀 快速开始

### 环境要求
- Python 3.9+
- 任意一家 OpenAI 兼容 API 的 Key（推荐 [DeepSeek](https://platform.deepseek.com/) / [智谱 GLM](https://open.bigmodel.cn/) / [字节豆包](https://www.volcengine.com/product/ark) 等国内服务）

### 安装

```bash
git clone https://github.com/<your-username>/silian.git
cd silian
pip install -r requirements.txt
```

### 配置

复制环境变量示例文件并填入你的 API Key：

```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

编辑 `.env`，至少配置一组 LLM 凭据（推荐使用通用配置）：

```env
LLM_API_KEY=your_api_key_here
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```

### 启动

```bash
# Windows 一键启动
start.bat

# 或手动启动
python main.py
```

启动后访问：
- 应用首页：<http://localhost:8000/app>
- API 文档：<http://localhost:8000/docs>

---

## 📁 项目结构

```
silian/
├── app/                    # 后端核心模块
│   ├── routes/             # 路由：AI、会话、分支、上下文、聊天
│   ├── ai_models.py        # 多模型统一管理
│   ├── config.py           # 配置（pydantic-settings）
│   ├── context.py          # 节点树上下文构建
│   ├── storage.py          # 本地 JSON 存储
│   └── logger.py           # 日志
├── static/                 # 前端静态资源
│   ├── js/                 # api / app / chat / mindmap / session 等
│   └── css/style.css
├── templates/index.html    # 单页入口
├── main.py                 # FastAPI 入口
├── requirements.txt
├── .env.example            # 环境变量模板（不含真实密钥）
└── start.bat               # Windows 启动脚本
```

---

## 🤝 贡献

欢迎提交 Issue 与 Pull Request！

1. Fork 本仓库
2. 创建你的特性分支：`git checkout -b feature/awesome-feature`
3. 提交改动：`git commit -m 'feat: add awesome feature'`
4. 推送分支：`git push origin feature/awesome-feature`
5. 提交 Pull Request

---

## 📄 License

本项目基于 [MIT License](./LICENSE) 开源。
