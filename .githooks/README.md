# Git Hooks

本项目使用 Git Hooks 来确保代码质量。

## 已配置的 Hooks

### pre-commit
提交前自动检查：
- 是否有功能性变更需要更新 README.md
- 检测范围：`src/views/`、`src/router/`、`src/layouts/`、`package.json`

## 安装 Hooks

```bash
# 配置 Git 使用本目录的 hooks
git config core.hooksPath .githooks

# 给 hooks 添加执行权限（Linux/macOS）
chmod +x .githooks/pre-commit
```

## 跳过 Hooks（不推荐）

```bash
git commit --no-verify
```
