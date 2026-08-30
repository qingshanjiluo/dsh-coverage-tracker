# dsh-coverage-tracker

DSH plugin for tracking code coverage and visualizing coverage heatmaps.

## Features

- **Coverage Collection**: Run tests and collect coverage data with `coverage_run`
- **Report Generation**: Generate detailed coverage reports in multiple formats (text, html, json, lcov)
- **Heatmap Visualization**: Visualize coverage with color-coded heatmaps showing low/high coverage files
- **Threshold Checking**: Automatically check if coverage meets your configured threshold
- **History Tracking**: Track coverage trends over time with up to 100 historical snapshots
- **Low Coverage Alerts**: Get notified when files fall below the coverage threshold

## Installation

```bash
# Via DSH CLI
dsh install dsh-coverage-tracker

# Or manually
git clone https://github.com/qingshanjiluo/dsh-coverage-tracker.git
cd dsh-coverage-tracker
npm install
npm run build
```

## Tools

| Tool | Description |
|------|-------------|
| `coverage_run` | Run tests and collect coverage data |
| `coverage_report` | Generate coverage report |
| `coverage_heatmap` | Display coverage heatmap |
| `coverage_history` | View coverage history trends |
| `coverage_check` | Check if coverage meets threshold |

## Commands

| Command | Description |
|---------|-------------|
| `/coverage run` | Run tests and collect coverage |
| `/coverage report` | Generate and view coverage report |
| `/coverage heatmap` | View coverage heatmap |
| `/coverage history` | View coverage history |
| `/coverage check` | Check coverage against threshold |

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the plugin |
| `threshold` | number | `80` | Coverage threshold percentage (0-100) |
| `format` | enum | `html` | Report format: text, html, json, lcov |
| `exclude` | string[] | `['node_modules', 'dist', '__tests__']` | Directories to exclude |
| `historyFile` | string | `.coverage-history.json` | Path to store coverage history |

## Usage

1. Run your tests with coverage enabled
2. Use `/coverage report` to generate a report
3. View the heatmap with `/coverage heatmap`
4. Check if coverage meets threshold with `/coverage check`
5. Track trends over time with `/coverage history`

## License

MIT
