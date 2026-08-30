/**
 * dsh-coverage-tracker — 代码覆盖率追踪
 *
 * 功能：
 * 1. 收集代码覆盖率数据
 * 2. 生成覆盖率报告
 * 3. 可视化覆盖热力图
 * 4. 低覆盖文件提醒
 * 5. 历史趋势追踪
 *
 * 工具：coverage_run, coverage_report, coverage_heatmap, coverage_history, coverage_check
 * 命令：/coverage
 * 配置：enabled, threshold, format, exclude
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

export const name = 'dsh-coverage-tracker';
export const inject = ['settings', 'tools', 'commands'];

const configSchema = z.object({
  enabled: z.boolean().default(true),
  threshold: z.number().min(0).max(100).default(80),
  format: z.enum(['text', 'html', 'json', 'lcov']).default('html'),
  exclude: z.array(z.string()).default(['node_modules', 'dist', '__tests__']),
  historyFile: z.string().default('.coverage-history.json'),
});

type Config = z.infer<typeof configSchema>;

interface CoverageData {
  timestamp: string;
  total: number;
  branches: number;
  functions: number;
  lines: number;
  statements: number;
  files: Record<string, { lines: number; branches: number; functions: number }>;
}

function parseLcov(lcovPath: string): CoverageData {
  const content = readFileSync(lcovPath, 'utf-8');
  const files: Record<string, any> = {};
  let currentFile = '';
  let totalLines = 0, totalCovered = 0;

  for (const line of content.split('\n')) {
    if (line.startsWith('SF:')) currentFile = line.substring(3);
    else if (line.startsWith('LF:')) totalLines = parseInt(line.substring(3));
    else if (line.startsWith('LH:')) totalCovered = parseInt(line.substring(3));
    else if (line.startsWith('end_of_record')) {
      if (currentFile) {
        files[currentFile] = {
          lines: totalLines > 0 ? Math.round((totalCovered / totalLines) * 100) : 0,
          branches: 0,
          functions: 0,
        };
      }
      currentFile = '';
    }
  }

  const allPercents = Object.values(files).map(f => f.lines);
  const avg = allPercents.length > 0 ? Math.round(allPercents.reduce((a, b) => a + b, 0) / allPercents.length) : 0;

  return {
    timestamp: new Date().toISOString(),
    total: avg,
    branches: avg,
    functions: avg,
    lines: avg,
    statements: avg,
    files,
  };
}

function loadHistory(filePath: string): CoverageData[] {
  if (!existsSync(filePath)) return [];
  try { return JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return []; }
}

function saveHistory(filePath: string, data: CoverageData[]) {
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function generateHeatmap(data: CoverageData): string {
  const lines = ['# 覆盖率热力图\n'];
  const sorted = Object.entries(data.files).sort((a, b) => a[1].lines - b[1].lines);

  for (const [file, cov] of sorted) {
    const color = cov.lines >= 80 ? '🟢' : cov.lines >= 50 ? '🟡' : '🔴';
    lines.push(`${color} **${file}**: ${cov.lines}%`);
  }

  lines.push(`\n## 总计: ${data.total}%`);
  if (data.total < 80) lines.push(`⚠️ 低于阈值 80%`);
  return lines.join('\n');
}

export function apply(ctx: any, config: Config) {
  if (!config.enabled) return;

  ctx.tools.register({
    name: 'coverage_run',
    description: '运行测试并收集覆盖率',
    parameters: z.object({
      command: z.string().optional().describe('测试命令'),
      framework: z.enum(['jest', 'vitest', 'pytest', 'gotest']).optional(),
    }),
    async execute({ command, framework }: any) {
      try {
        const testCmd = command || `npx ${framework || 'jest'} --coverage`;
        execSync(testCmd, { encoding: 'utf-8', stdio: 'pipe' });
        return { success: true, message: '覆盖率数据已收集' };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  });

  ctx.tools.register({
    name: 'coverage_report',
    description: '生成覆盖率报告',
    parameters: z.object({
      format: z.enum(['text', 'html', 'json', 'lcov']).optional(),
    }),
    async execute({ format }: any) {
      const fmt = format || config.format;
      const lcovPath = 'coverage/lcov.info';
      if (!existsSync(lcovPath)) return { error: '未找到覆盖率数据，请先运行 /coverage run' };

      const data = parseLcov(lcovPath);
      const history = loadHistory(resolve(config.historyFile));
      history.push(data);
      if (history.length > 100) history.shift();
      saveHistory(resolve(config.historyFile), history);

      if (fmt === 'text') return { report: generateHeatmap(data) };
      return { data, report: generateHeatmap(data) };
    },
  });

  ctx.tools.register({
    name: 'coverage_heatmap',
    description: '显示覆盖率热力图',
    parameters: z.object({}),
    async execute() {
      const lcovPath = 'coverage/lcov.info';
      if (!existsSync(lcovPath)) return { error: '未找到覆盖率数据' };
      const data = parseLcov(lcovPath);
      return { heatmap: generateHeatmap(data), total: data.total };
    },
  });

  ctx.tools.register({
    name: 'coverage_history',
    description: '查看覆盖率历史趋势',
    parameters: z.object({ limit: z.number().default(10) }),
    async execute({ limit }: any) {
      const history = loadHistory(resolve(config.historyFile));
      const recent = history.slice(-limit);
      if (recent.length === 0) return { message: '暂无历史数据' };

      const trend = recent.map((h, i) => ({
        date: h.timestamp.split('T')[0],
        total: h.total,
        change: i > 0 ? h.total - recent[i - 1].total : 0,
      }));

      return { history: trend, current: recent[recent.length - 1].total };
    },
  });

  ctx.tools.register({
    name: 'coverage_check',
    description: '检查覆盖率是否达标',
    parameters: z.object({}),
    async execute() {
      const lcovPath = 'coverage/lcov.info';
      if (!existsSync(lcovPath)) return { error: '未找到覆盖率数据' };
      const data = parseLcov(lcovPath);
      const passed = data.total >= config.threshold;
      return {
        total: data.total,
        threshold: config.threshold,
        passed,
        message: passed ? `✅ 覆盖率 ${data.total}% 达标` : `⚠️ 覆盖率 ${data.total}% 低于阈值 ${config.threshold}%`,
      };
    },
  });

  ctx.commands.register({
    name: 'coverage',
    description: '覆盖率管理',
    async execute(args: string) {
      const action = args.trim() || 'report';
      const result = await ctx.tools.execute(`coverage_${action}`, {});
      return { content: JSON.stringify(result, null, 2) };
    },
  });

  ctx.settings.register({
    title: 'coverage-tracker',
    description: '代码覆盖率追踪',
    config: configSchema,
  });
}
