/**
 * LCOV coverage-report analyzer for DeepSeek Harness. `coverage_parse`
 * aggregates line/branch/function totals from an lcov tracefile passed as text;
 * `coverage_check` compares per-file line coverage against a threshold;
 * `coverage_heatmap` ranks every file with a low/medium/high bar row. All three
 * tools are pure string parsing — no filesystem, subprocess, or network access;
 * the model (or a caller) supplies the `coverage/lcov.info` content.
 * @module @qingshanjiluo/dsh-coverage-tracker
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-coverage-tracker'
export const inject = ['tools']

/** Deployment configuration for the coverage analyzer. */
export interface Config {
  /**
   * Line-coverage percentage that `coverage_check` requires per file when the
   * caller does not pass an explicit `minLines`.
   */
  defaultMinLines: number
  /** Row share, or higher, that `coverage_heatmap` labels `high`. */
  highThreshold: number
  /** Below this share, `coverage_heatmap` labels a row `low`; otherwise `medium`. */
  lowThreshold: number
}

/** Schemastery configuration for the coverage analyzer. */
export const Config: z<Config> = z.object({
  defaultMinLines: z.number().default(80),
  highThreshold: z.number().default(80),
  lowThreshold: z.number().default(50),
})

interface Counts {
  found: number
  hit: number
}

interface FileCoverage {
  file: string
  lines: Counts
  branches: Counts
  functions: Counts
}

type CoverageLevel = 'high' | 'medium' | 'low'

/**
 * Parse one lcov integer field, tolerating junk and clamping negatives.
 * @param raw - text after the record prefix (or a comma-separated part).
 * @returns the non-negative integer value, or `null` when unparseable.
 */
function toInt(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const n = Number(raw.trim())
  return Number.isFinite(n) ? Math.max(Math.trunc(n), 0) : null
}

/**
 * Percentage rounded to one decimal; 0 when nothing was instrumented.
 * @param c - found/hit counters.
 * @returns coverage share of `hit` over `found` as a percentage.
 */
function pctOf(c: Counts): number {
  return c.found === 0 ? 0 : Math.round((c.hit / c.found) * 1000) / 10
}

/**
 * Parse LCOV tracefile text into per-file counters.
 *
 * Honors SF/DA/LF/LH/BRDA/BRF/BRH/FN/FNDA/FNF/FNH/end_of_record records;
 * unknown records (TN, VR, ...) are ignored. Detail records (DA, BRDA, FNDA)
 * win over their summary counterparts, and multiple sections sharing one SF
 * path are merged.
 * @param text - the complete lcov file content.
 * @returns one entry per source file, in first-seen order.
 */
function parseLcov(text: string): FileCoverage[] {
  const merged = new Map<string, FileCoverage>()

  let file: string | null = null
  let daFound = 0
  let daHit = 0
  let lf: number | null = null
  let lh: number | null = null
  let brf: number | null = null
  let brh: number | null = null
  let brdaFound = 0
  let brdaHit = 0
  let fnf: number | null = null
  let fnh: number | null = null
  let fndaFound = 0
  let fndaHit = 0
  let fnSeen = 0

  function flush(): void {
    if (file === null) return
    const key = file
    const lines: Counts = daFound > 0
      ? { found: daFound, hit: daHit }
      : { found: lf ?? 0, hit: lh ?? 0 }
    const branches: Counts = brf !== null
      ? { found: brf, hit: brh ?? 0 }
      : { found: brdaFound, hit: brdaHit }
    const functions: Counts = fnf !== null
      ? { found: fnf, hit: fnh ?? 0 }
      : fndaFound > 0
        ? { found: fndaFound, hit: fndaHit }
        : { found: fnSeen, hit: 0 }
    const prev = merged.get(key)
    if (prev) {
      prev.lines = { found: prev.lines.found + lines.found, hit: prev.lines.hit + lines.hit }
      prev.branches = { found: prev.branches.found + branches.found, hit: prev.branches.hit + branches.hit }
      prev.functions = { found: prev.functions.found + functions.found, hit: prev.functions.hit + functions.hit }
    } else {
      merged.set(key, { file: key, lines, branches, functions })
    }
    file = null
    daFound = 0
    daHit = 0
    lf = null
    lh = null
    brf = null
    brh = null
    brdaFound = 0
    brdaHit = 0
    fnf = null
    fnh = null
    fndaFound = 0
    fndaHit = 0
    fnSeen = 0
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (line === 'end_of_record') {
      flush()
      continue
    }
    const prefix = line.slice(0, 3)
    if (prefix === 'SF:') {
      flush() // tolerate a record without its end_of_record
      file = line.slice(3).trim() || '(unknown)'
      continue
    }
    if (file === null) continue // fields outside any record are ignored
    if (prefix === 'DA:') {
      const hits = toInt(line.slice(3).split(',')[1])
      daFound += 1
      if (hits !== null && hits > 0) daHit += 1
    } else if (prefix === 'LF:') {
      lf = toInt(line.slice(3))
    } else if (prefix === 'LH:') {
      lh = toInt(line.slice(3))
    } else if (line.startsWith('BRDA:')) {
      const taken = line.slice(5).split(',')[3]
      brdaFound += 1
      if (taken !== undefined && taken.trim() !== '-') {
        const hits = toInt(taken)
        if (hits !== null && hits > 0) brdaHit += 1
      }
    } else if (prefix === 'BRF:') {
      brf = toInt(line.slice(3))
    } else if (prefix === 'BRH:') {
      brh = toInt(line.slice(3))
    } else if (prefix === 'FNF:') {
      fnf = toInt(line.slice(3))
    } else if (prefix === 'FNH:') {
      fnh = toInt(line.slice(3))
    } else if (line.startsWith('FNDA:')) {
      const hits = toInt(line.slice(5).split(',')[0])
      fndaFound += 1
      if (hits !== null && hits > 0) fndaHit += 1
    } else if (prefix === 'FN:') {
      fnSeen += 1
    }
    // TN:, VR:, and unknown records fall through ignored.
  }
  flush()
  return [...merged.values()]
}

/**
 * Sum found/hit counters.
 * @param counts - counters to fold.
 * @returns the combined counter.
 */
function sum(counts: readonly Counts[]): Counts {
  return counts.reduce<Counts>((acc, c) => ({ found: acc.found + c.found, hit: acc.hit + c.hit }), { found: 0, hit: 0 })
}

/**
 * Register the coverage tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment's explicit analyzer policy.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'coverage_parse',
    description:
      'Aggregate an LCOV tracefile (pass the TEXT of coverage/lcov.info, not a path) ' +
      'into total lines/branches/functions found vs. hit, plus line and branch ' +
      'coverage percentages rounded to one decimal.',
    parameters: {
      lcovText: {
        type: 'string',
        required: true,
        description: 'Complete lcov tracefile content (SF/DA/BRF/BRH/FNF/FNH/end_of_record records).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lines: {
            type: 'object',
            additionalProperties: false,
            required: true,
            description: 'Line totals summed over every file.',
            properties: {
              found: { type: 'integer', required: true, description: 'Instrumented lines (DA records).' },
              hit: { type: 'integer', required: true, description: 'Lines executed at least once.' },
            },
          },
          branches: {
            type: 'object',
            additionalProperties: false,
            required: true,
            description: 'Branch totals summed over every file.',
            properties: {
              found: { type: 'integer', required: true, description: 'Branches found (BRF or BRDA records).' },
              hit: { type: 'integer', required: true, description: 'Branches taken at least once.' },
            },
          },
          functions: {
            type: 'object',
            additionalProperties: false,
            required: true,
            description: 'Function totals summed over every file.',
            properties: {
              found: { type: 'integer', required: true, description: 'Functions found (FNF or FN/FNDA records).' },
              hit: { type: 'integer', required: true, description: 'Functions called at least once.' },
            },
          },
          pct: {
            type: 'object',
            additionalProperties: false,
            required: true,
            description: 'Overall coverage percentages rounded to one decimal.',
            properties: {
              lines: { type: 'number', required: true, description: 'Hit/found lines as a percentage (0-100).' },
              branches: { type: 'number', required: true, description: 'Hit/found branches as a percentage (0-100).' },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `lines:     ${value.lines.hit}/${value.lines.found} (${value.pct.lines}%)`,
          `branches:  ${value.branches.hit}/${value.branches.found} (${value.pct.branches}%)`,
          `functions: ${value.functions.hit}/${value.functions.found}`,
        ].join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    execute(args) {
      const files = parseLcov(args.lcovText)
      const lines = sum(files.map(f => f.lines))
      const branches = sum(files.map(f => f.branches))
      const functions = sum(files.map(f => f.functions))
      return Promise.resolve({
        lines,
        branches,
        functions,
        pct: { lines: pctOf(lines), branches: pctOf(branches) },
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'coverage_check',
    description:
      'Check an LCOV tracefile (text of coverage/lcov.info) per file against a ' +
      'minimum line-coverage percentage. Returns pass/fail and the sorted list ' +
      'of files below the threshold. Pass minLines to override the configured default.',
    parameters: {
      lcovText: {
        type: 'string',
        required: true,
        description: 'Complete lcov tracefile content.',
      },
      minLines: {
        type: 'number',
        description: 'Required line-coverage percentage per file (0-100); omit to use the configured default.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pass: { type: 'boolean', required: true, description: 'True when no file is below the threshold.' },
          minLines: { type: 'number', required: true, description: 'Threshold actually applied.' },
          checked: { type: 'integer', required: true, description: 'Number of files inspected.' },
          below: {
            type: 'array',
            required: true,
            description: 'Sorted paths of files whose line coverage is below minLines.',
            items: { type: 'string' },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.checked === 0
          ? 'No lcov records found; nothing to check.'
          : value.pass
            ? `PASS — all ${value.checked} file(s) at or above ${value.minLines}% line coverage.`
            : `FAIL — ${value.below.length}/${value.checked} file(s) below ${value.minLines}% line coverage:\n- ${value.below.join('\n- ')}`,
      }],
    },
    isConcurrencySafe: () => true,
    execute(args) {
      const threshold = args.minLines ?? config.defaultMinLines
      const files = parseLcov(args.lcovText)
      const below = files
        .filter(f => pctOf(f.lines) < threshold)
        .map(f => f.file)
        .sort()
      return Promise.resolve({ pass: below.length === 0, minLines: threshold, checked: files.length, below })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'coverage_heatmap',
    description:
      'Build a text heatmap of per-file line coverage from an LCOV tracefile ' +
      '(text of coverage/lcov.info). Files are ranked worst-first with a ' +
      'ten-character block bar and a high/medium/low label from the configured thresholds.',
    parameters: {
      lcovText: {
        type: 'string',
        required: true,
        description: 'Complete lcov tracefile content.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rows: {
            type: 'array',
            required: true,
            description: 'One row per file, sorted by ascending coverage (worst first, ties by path).',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                file: { type: 'string', required: true, description: 'Source path from the SF record.' },
                found: { type: 'integer', required: true, description: 'Instrumented lines in this file.' },
                hit: { type: 'integer', required: true, description: 'Lines executed at least once.' },
                pct: { type: 'number', required: true, description: 'Line coverage percentage, one decimal.' },
                level: { type: 'string', required: true, enum: ['high', 'medium', 'low'], description: 'Heat label from configured thresholds.' },
                bar: { type: 'string', required: true, description: 'Ten-character block bar of the coverage share.' },
              },
            },
          },
          total: {
            type: 'object',
            additionalProperties: false,
            required: true,
            description: 'Overall line coverage across all files.',
            properties: {
              found: { type: 'integer', required: true, description: 'Total instrumented lines.' },
              hit: { type: 'integer', required: true, description: 'Total executed lines.' },
              pct: { type: 'number', required: true, description: 'Overall percentage, one decimal.' },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.rows.length === 0
          ? 'No lcov records found.'
          : [
              'coverage heatmap (worst first)',
              ...value.rows.map(r => `${r.bar} ${String(r.pct).padStart(5)}% [${r.level}] ${r.file} (${r.hit}/${r.found})`),
              `total: ${value.total.hit}/${value.total.found} lines (${value.total.pct}%)`,
            ].join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    execute(args) {
      const files = parseLcov(args.lcovText)
      const rows = files
        .map(f => {
          const pct = pctOf(f.lines)
          const level: CoverageLevel = pct >= config.highThreshold ? 'high' : pct >= config.lowThreshold ? 'medium' : 'low'
          const filled = Math.round(pct / 10)
          return {
            file: f.file,
            found: f.lines.found,
            hit: f.lines.hit,
            pct,
            level,
            bar: '█'.repeat(filled) + '░'.repeat(10 - filled),
          }
        })
        .sort((a, b) => a.pct - b.pct || a.file.localeCompare(b.file))
      const total = sum(files.map(f => f.lines))
      return Promise.resolve({ rows, total: { found: total.found, hit: total.hit, pct: pctOf(total) } })
    },
  }))
}
