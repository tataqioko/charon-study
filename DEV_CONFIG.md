# 本地开发环境配置说明

## 自定义 API 配置（仅开发环境）

如果你需要在本地开发时使用自定义的 API 站点或 Key：

### 1. 创建 `.env.local` 文件

```bash
cp .env.example .env.local
```

### 2. 编辑 `.env.local`

```env
# 自定义 API 站点（开发环境生效）
VITE_DEV_API_BASE_URL=https://your-custom-api.com/v1

# 可选：预设 API Key（避免每次填写）
VITE_DEV_API_KEY=sk-your-key-here

# 可选：预设默认模型
VITE_DEV_DEFAULT_MODEL=gpt-4
```

### 3. 启动开发服务器

```bash
# Windows
dev-start.bat

# 或直接用 pnpm（需手动设置环境变量）
pnpm tauri dev
```

## 注意事项

- `.env.local` 文件已在 `.gitignore` 中，不会提交到仓库
- 自定义配置**仅在开发环境生效**（`debug_assertions`）
- 生产构建始终使用默认站点 `https://api.nktp.top/v1`
- `*.bat` 脚本也不会提交到仓库（除 `build.bat`）

## 生产构建

生产构建会忽略所有开发环境变量，始终锁定官方站点：

```bash
pnpm tauri build
```
