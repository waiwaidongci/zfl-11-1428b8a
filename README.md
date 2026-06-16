# 舞台灯光租赁管理

## 快速开始

```bash
npm start
```

访问 `http://localhost:3011`。系统支持设备列表、租赁订单、时间段占用校验、维修设备拦截、待出库和待归还看板。

---

## 目录结构

```
.
├── data/
│   ├── db.js              # 数据库访问层
│   └── rental.json        # 生产数据（请勿手动编辑）
├── lib/                   # 业务逻辑库
├── routes/                # API 路由
├── public/                # 前端静态资源
├── test/                  # 测试文件
├── scripts/
│   └── preflight.js       # 启动前检查脚本
├── .github/workflows/
│   └── ci.yml             # CI 配置
└── server.js              # 应用入口
```

---

## 开发流程

### 1. 环境配置

复制环境变量模板并按需修改：

```bash
cp .env.example .env
```

支持的环境变量：

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | `3011` | 服务监听端口 |
| `RENTAL_DB_PATH` | `data/rental.json` | 数据文件路径 |
| `NODE_ENV` | `development` | 运行环境 |

### 2. 启动开发服务器

```bash
# 常规启动（含启动前检查）
npm start

# 开发模式（文件变更自动重启）
npm run dev

# 仅执行启动前检查
npm run preflight
```

启动前检查会自动验证：
- 端口是否被占用
- 数据文件是否存在且可读写
- 数据目录权限是否正确

---

## 数据隔离机制

### 生产数据与测试数据分离

系统通过 `RENTAL_DB_PATH` 环境变量实现数据路径隔离：

| 场景 | 数据路径 | 说明 |
|------|----------|------|
| 生产/开发 | `data/rental.json` | 默认路径，真实业务数据 |
| 自动化测试 | `data/test/rental.test.json` | 测试专用路径，自动创建和清理 |
| 自定义 | 通过环境变量指定 | 适用于多环境部署 |

### 测试数据生命周期

1. `npm run pretest` - 自动创建 `data/test/` 目录并设置测试环境
2. 测试运行期间 - 所有读写操作都在 `data/test/rental.test.json`
3. `npm run posttest` - 自动删除测试数据目录，确保不残留

### 手动切换数据路径

```bash
# 使用备用数据文件启动
RENTAL_DB_PATH=data/rental-backup.json npm start

# 使用绝对路径
RENTAL_DB_PATH=/tmp/test-rental.json npm start
```

> **重要**：`data/test/` 目录已加入 `.gitignore`，不会被提交到版本库。

---

## 测试流程

### 运行所有测试

```bash
npm test
```

测试使用 Node.js 内置 `node:test` 框架，无需额外依赖。

### 测试文件位置

- `test/equipmentAvailability.test.js` - 设备可用性校验
- `test/quoteCalculator.test.js` - 报价计算逻辑
- `test/db-integration.test.js` - 数据库集成与数据隔离

### 编写新测试

使用测试帮助器确保数据隔离：

```javascript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, cleanupTestEnv, createTestDb, buildMockDb } from "./test-helper.js";

describe("你的测试套件", () => {
  before(async () => {
    await setupTestEnv();  // 设置测试环境，切换到测试数据库
  });

  after(async () => {
    await cleanupTestEnv(); // 清理测试数据
  });

  it("测试用例", async () => {
    await createTestDb({ /* 自定义种子数据 */ });
    // 测试逻辑...
  });
});
```

### 测试相关命令

```bash
# 运行测试并查看详细输出
npm test -- --test-reporter=spec

# 仅运行特定测试文件
node --test test/equipmentAvailability.test.js

# 手动清理测试数据
npm run test:clean
```

---

## 持续集成 (CI)

项目配置了 GitHub Actions，在推送和 PR 时自动运行：

### CI 流程

1. **环境准备** - 安装 Node.js 20.x 和 22.x（矩阵测试）
2. **端口检查** - 验证 3011 端口可用
3. **数据验证** - 检查生产数据文件结构完整性
4. **启动前检查** - 运行 preflight 脚本
5. **运行测试** - 执行所有自动化测试
6. **隔离验证** - 确认测试数据已清理且未污染生产数据

### 查看 CI 结果

访问仓库的 **Actions** 标签页查看详细的 CI 运行日志。

---

## 常见故障处理

### 端口占用

**症状**：
```
[preflight] ✗ 端口 3011 已被占用
```

**解决方案**：

```bash
# 查找占用端口的进程
lsof -i :3011

# 或使用 netstat
netstat -anp tcp | grep 3011

# 杀掉进程（替换 PID）
kill -9 <PID>

# 或使用其他端口启动
PORT=3012 npm start
```

### 数据文件权限问题

**症状**：
```
[preflight] ✗ 数据文件权限不足
```

**解决方案**：

```bash
# 修复数据目录权限
chmod -R 755 data/
chmod 644 data/rental.json

# 检查当前用户对目录的权限
ls -la data/
```

### 数据文件损坏

**症状**：启动时 JSON 解析错误

**解决方案**：

1. 检查备份（如果有）
2. 验证 JSON 格式：
   ```bash
   node -e "JSON.parse(require('fs').readFileSync('data/rental.json', 'utf8'))"
   ```
3. 如果损坏严重，删除后重启会自动重建种子数据：
   ```bash
   mv data/rental.json data/rental.json.bak
   npm start
   ```

### 测试数据未清理

**症状**：`data/test/` 目录残留

**解决方案**：

```bash
# 手动清理
npm run test:clean

# 或直接删除
rm -rf data/test/
```

### 测试污染生产数据

**预防措施**：
- 永远不要在测试中硬编码 `data/rental.json` 路径
- 始终使用 `test-helper.js` 中的 `setupTestEnv()`
- CI 会自动验证数据隔离

**应急处理**：
```bash
# 从 git 恢复数据文件
git checkout -- data/rental.json

# 或从备份恢复
cp data/rental.json.bak data/rental.json
```

### Node.js 版本不兼容

**要求**：Node.js >= 20.0.0

```bash
# 检查版本
node --version

# 使用 nvm 切换版本（如果已安装）
nvm use 20
```

---

## 脚本速查

| 命令 | 说明 |
|------|------|
| `npm start` | 启动服务（含 preflight 检查） |
| `npm run dev` | 开发模式，自动重启 |
| `npm test` | 运行所有测试 |
| `npm run test:clean` | 清理测试数据 |
| `npm run preflight` | 仅运行启动前检查 |

---

## 功能模块

- 订单中心: `/`
- 报价管理: `/quotations`
- 设备管理: `/equipment`
- 客户管理: `/customers`
- 维修工单: `/repairs`
- 租期排期: `/schedule`
- 项目结算: `/settlement`
- 库存盘点: `/stocktake`
