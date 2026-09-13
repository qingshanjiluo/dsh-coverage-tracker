import { describe, expect, it } from 'vitest'
import { apply, Config, inject, name } from '../src/index.ts'

interface RegisteredTool {
  name: string
  execute(args: never, exec: never): Promise<unknown>
}

interface PluginConfig {
  defaultMinLines: number
  highThreshold: number
  lowThreshold: number
}

const DEFAULTS: PluginConfig = { defaultMinLines: 80, highThreshold: 80, lowThreshold: 50 }

function mountPlugin(config: PluginConfig = DEFAULTS): RegisteredTool[] {
  const registered: RegisteredTool[] = []
  const ctx = { tools: { register: (def: RegisteredTool) => registered.push(def) } }
  // The plugin only reads ctx.tools; a partial stub is the real registrant surface it touches.
  apply(ctx as never, config as never)
  return registered
}

function tool(toolName: string, config: PluginConfig = DEFAULTS): RegisteredTool {
  const found = mountPlugin(config).find(t => t.name === toolName)
  if (!found) throw new Error(`tool ${toolName} not registered`)
  return found
}

/** Two-file lcov report with DA/BRDA/BRF/BRH/FNF/FNH/FN/FNDA records. */
const TWO_FILES = [
  'TN:case-a',
  'SF:src/alpha.ts',
  'FN:1,one',
  'FN:5,two',
  'FNF:2',
  'FNH:1',
  'FNDA:1,one',
  'FNDA:0,two',
  'BRDA:1,0,0,2',
  'BRDA:1,0,1,0',
  'BRDA:9,1,0,-',
  'BRF:3',
  'BRH:1',
  'DA:1,3',
  'DA:2,0',
  'DA:3,7',
  'LF:3',
  'LH:2',
  'end_of_record',
  'TN:case-a',
  'SF:src/beta.ts',
  'DA:1,0',
  'DA:2,0',
  'LF:2',
  'LH:0',
  'end_of_record',
].join('\n')

describe('dsh-coverage-tracker plugin contract', () => {
  it('exports the loader plugin face', () => {
    expect(name).toBe('dsh-coverage-tracker')
    expect(inject).toEqual(['tools'])
    expect(typeof apply).toBe('function')
    expect(Config).toBeInstanceOf(Object)
  })

  it('registers the three documented tools', () => {
    const tools = mountPlugin()
    expect(tools.map(t => t.name).sort()).toEqual(['coverage_check', 'coverage_heatmap', 'coverage_parse'])
  })
})

describe('coverage_parse', () => {
  it('sums per-file DA/BRF/BRH/FNF/FNH records into totals and percentages', async () => {
    const result = await tool('coverage_parse').execute({ lcovText: TWO_FILES } as never, {} as never)
    expect(result).toEqual({
      lines: { found: 5, hit: 2 },
      branches: { found: 3, hit: 1 },
      functions: { found: 2, hit: 1 },
      pct: { lines: 40, branches: 33.3 },
    })
  })

  it('returns all-zero counters for empty or junk input', async () => {
    const result = await tool('coverage_parse').execute({ lcovText: 'not lcov at all' } as never, {} as never) as {
      lines: { found: number; hit: number }
      pct: { lines: number; branches: number }
    }
    expect(result.lines).toEqual({ found: 0, hit: 0 })
    expect(result.pct).toEqual({ lines: 0, branches: 0 })
  })

  it('merges repeated sections for the same SF path and tolerates CRLF', async () => {
    const dup = [
      'SF:src/dup.ts',
      'DA:1,1',
      'end_of_record',
      'SF:src/dup.ts',
      'DA:2,0',
      'DA:3,2',
      'end_of_record',
    ].join('\r\n')
    const result = await tool('coverage_parse').execute({ lcovText: dup } as never, {} as never) as {
      lines: { found: number; hit: number }
      pct: { lines: number }
    }
    expect(result.lines).toEqual({ found: 3, hit: 2 })
    expect(result.pct.lines).toBe(66.7)
  })

  it('falls back to LF/LH, BRDA counts, and FN counts when summaries are absent', async () => {
    const text = [
      'SF:src/fallback.ts',
      'LF:4',
      'LH:1',
      'BRDA:2,0,0,1',
      'BRDA:2,0,1,0',
      'FN:1,a',
      'FN:9,b',
      'end_of_record',
    ].join('\n')
    const result = await tool('coverage_parse').execute({ lcovText: text } as never, {} as never) as {
      lines: { found: number; hit: number }
      branches: { found: number; hit: number }
      functions: { found: number; hit: number }
      pct: { lines: number; branches: number }
    }
    expect(result.lines).toEqual({ found: 4, hit: 1 })
    expect(result.branches).toEqual({ found: 2, hit: 1 })
    expect(result.functions).toEqual({ found: 2, hit: 0 })
    expect(result.pct).toEqual({ lines: 25, branches: 50 })
  })
})

describe('coverage_check', () => {
  it('lists every file below the configured default threshold', async () => {
    const result = await tool('coverage_check').execute({ lcovText: TWO_FILES } as never, {} as never) as {
      pass: boolean
      minLines: number
      checked: number
      below: string[]
    }
    expect(result).toEqual({
      pass: false,
      minLines: 80,
      checked: 2,
      below: ['src/alpha.ts', 'src/beta.ts'],
    })
  })

  it('honours an explicit minLines override and passes a fully covered report', async () => {
    const result = await tool('coverage_check').execute({ lcovText: TWO_FILES, minLines: 50 } as never, {} as never) as {
      pass: boolean
      minLines: number
      below: string[]
    }
    expect(result.minLines).toBe(50)
    expect(result.below).toEqual(['src/beta.ts'])
    expect(result.pass).toBe(false)

    const clean = await tool('coverage_check').execute({ lcovText: TWO_FILES, minLines: 0 } as never, {} as never) as {
      pass: boolean
      minLines: number
      checked: number
      below: string[]
    }
    expect(clean).toEqual({ pass: true, minLines: 0, checked: 2, below: [] })
  })

  it('vacuously passes on input without lcov records', async () => {
    const result = await tool('coverage_check').execute({ lcovText: '' } as never, {} as never) as {
      pass: boolean
      checked: number
      below: string[]
    }
    expect(result).toEqual({ pass: true, minLines: 80, checked: 0, below: [] })
  })

  it('uses a non-default configured threshold', async () => {
    const result = await tool('coverage_check', { defaultMinLines: 60, highThreshold: 80, lowThreshold: 50 })
      .execute({ lcovText: TWO_FILES } as never, {} as never) as { minLines: number; below: string[] }
    expect(result.minLines).toBe(60)
    expect(result.below).toEqual(['src/beta.ts']) // alpha is 66.7%
  })
})

describe('coverage_heatmap', () => {
  it('ranks files worst-first with bars and configured heat levels', async () => {
    const result = await tool('coverage_heatmap').execute({ lcovText: TWO_FILES } as never, {} as never) as {
      rows: Array<{ file: string; found: number; hit: number; pct: number; level: string; bar: string }>
      total: { found: number; hit: number; pct: number }
    }
    expect(result.rows.map(r => r.file)).toEqual(['src/beta.ts', 'src/alpha.ts'])
    expect(result.rows[0]).toEqual({
      file: 'src/beta.ts',
      found: 2,
      hit: 0,
      pct: 0,
      level: 'low',
      bar: '░░░░░░░░░░',
    })
    expect(result.rows[1]).toMatchObject({ pct: 66.7, level: 'medium', hit: 2, found: 3 })
    expect(result.total).toEqual({ found: 5, hit: 2, pct: 40 })
  })

  it('labels a fully covered file high and an empty report yields no rows', async () => {
    const perfect = ['SF:src/ok.ts', 'DA:1,1', 'DA:2,5', 'end_of_record'].join('\n')
    const high = await tool('coverage_heatmap').execute({ lcovText: perfect } as never, {} as never) as {
      rows: Array<{ level: string; bar: string }>
      total: { pct: number }
    }
    expect(high.rows[0]!.level).toBe('high')
    expect(high.rows[0]!.bar).toBe('██████████')
    expect(high.total.pct).toBe(100)

    const empty = await tool('coverage_heatmap').execute({ lcovText: 'TN:x\nend_of_record' } as never, {} as never) as {
      rows: unknown[]
      total: { found: number; hit: number; pct: number }
    }
    expect(empty.rows).toEqual([])
    expect(empty.total).toEqual({ found: 0, hit: 0, pct: 0 })
  })

  it('respects non-default heat thresholds', async () => {
    const text = ['SF:src/mid.ts', 'DA:1,1', 'DA:2,1', 'DA:3,0', 'DA:4,0', 'end_of_record'].join('\n') // 50%
    const result = await tool('coverage_heatmap', { defaultMinLines: 80, highThreshold: 90, lowThreshold: 60 })
      .execute({ lcovText: text } as never, {} as never) as { rows: Array<{ pct: number; level: string }> }
    expect(result.rows[0]).toMatchObject({ pct: 50, level: 'low' }) // below lowThreshold 60
  })
})
