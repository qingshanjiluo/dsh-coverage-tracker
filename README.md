# dsh-coverage-tracker

`@qingshanjiluo/dsh-coverage-tracker` — DeepSeek Harness 主机工具插件：把 LCOV 覆盖率报告（`coverage/lcov.info` 的**文本内容**）解析、达标检查与热力图排序做成三个纯函数工具。不读文件、不起子进程、不联网——由模型或调用方把 lcov 文本作为参数传入，因此完全确定性、可离线测试。

## Installation

```bash
npx -y @deepseek-ai/dsh plugin --profile web add @qingshanjiluo/dsh-coverage-tracker
```

## Tools

| Tool | 参数 | 返回 |
|------|------|------|
| `coverage_parse` | `lcovText` | 全局 `lines/branches/functions` 的 `found/hit` 计数与 `pct:{lines,branches}` 百分比（保留 1 位小数） |
| `coverage_check` | `lcovText`, `minLines?` | `{pass, minLines, checked, below:[file,...]}`：逐文件行覆盖率与阈值比较，`below` 按路径排序 |
| `coverage_heatmap` | `lcovText` | `{rows:[{file,found,hit,pct,level,bar}], total}`：按覆盖率从低到高排序的每文件热力行（`level` 为 `high/medium/low`） |

解析支持的 lcov 记录：`SF`、`DA`、`LF/LH`、`BRDA`、`BRF/BRH`、`FN`、`FNDA`、`FNF/FNH`、`end_of_record`；明细记录优先于汇总记录，同一 `SF` 路径的多个区段会合并。

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `defaultMinLines` | number | `80` | `coverage_check` 未显式传 `minLines` 时的每文件行覆盖率阈值（百分比） |
| `highThreshold` | number | `80` | `coverage_heatmap` 判定 `high` 的行覆盖率下限 |
| `lowThreshold` | number | `50` | 低于该值判定 `low`，否则 `medium` |

## Development

```bash
npm install --no-audit --no-fund
npm run typecheck   # tsc --noEmit
npm run build       # tsc + tsdown -> lib/index.js / lib/index.d.ts
npx vitest run      # 全部离线，无网络/子进程
node scripts/load-smoke.mjs   # 加载构建产物并断言工具注册
```

所有工具都是纯字符串解析，测试喂固定的 lcov 文本即可复现，无需任何外部覆盖率服务器；真实使用时请先由你的测试框架（vitest/istanbul/jest --coverage 等）生成 `coverage/lcov.info`，再把其内容传给这些工具。

## License

MIT
