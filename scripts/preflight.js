import { createServer } from "node:net";
import { access, constants } from "node:fs/promises";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

function resolveDbPath() {
  const envPath = process.env.RENTAL_DB_PATH;
  if (envPath) {
    return isAbsolute(envPath) ? envPath : join(projectRoot, envPath);
  }
  return join(projectRoot, "data", "rental.json");
}

async function checkPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`端口 ${port} 已被占用，请先关闭占用该端口的进程或修改 PORT 环境变量`));
      } else {
        reject(err);
      }
    });
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "127.0.0.1");
  });
}

async function checkDataFile(dbPath) {
  try {
    await access(dbPath, constants.F_OK | constants.R_OK | constants.W_OK);
    return { exists: true, writable: true, path: dbPath };
  } catch (err) {
    if (err.code === "ENOENT") {
      const dir = dirname(dbPath);
      try {
        await access(dir, constants.W_OK);
        return { exists: false, writable: true, path: dbPath, willCreate: true };
      } catch {
        throw new Error(`数据目录不可写: ${dir}，请检查目录权限`);
      }
    } else if (err.code === "EACCES") {
      throw new Error(`数据文件权限不足: ${dbPath}，请检查读写权限`);
    }
    throw err;
  }
}

async function main() {
  const port = Number(process.env.PORT || 3011);
  const dbPath = resolveDbPath();
  const nodeEnv = process.env.NODE_ENV || "development";

  console.log(`\n[preflight] 启动前检查 (环境: ${nodeEnv})`);
  console.log(`[preflight] ──────────────────────────────`);

  let passed = true;

  console.log(`[preflight] 检查端口 ${port} ...`);
  try {
    await checkPort(port);
    console.log(`[preflight] ✓ 端口 ${port} 可用`);
  } catch (err) {
    console.log(`[preflight] ✗ ${err.message}`);
    passed = false;
  }

  console.log(`[preflight] 检查数据文件 ${dbPath} ...`);
  try {
    const status = await checkDataFile(dbPath);
    if (status.exists) {
      console.log(`[preflight] ✓ 数据文件存在且可读写`);
    } else if (status.willCreate) {
      console.log(`[preflight] ⚠ 数据文件不存在，启动时将自动创建初始数据`);
    }
  } catch (err) {
    console.log(`[preflight] ✗ ${err.message}`);
    passed = false;
  }

  console.log(`[preflight] ──────────────────────────────`);

  if (!passed) {
    console.log(`[preflight] ✗ 启动前检查未通过，请修复上述问题后重试`);
    process.exit(1);
  }

  console.log(`[preflight] ✓ 所有检查通过\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[preflight] 检查失败:`, err.message);
  process.exit(1);
});
