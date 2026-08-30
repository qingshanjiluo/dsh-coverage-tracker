import React from 'react';
import { createSettingsCard } from '@deepseek-ai/dsh-settings';

export default createSettingsCard({
  title: 'coverage-tracker',
  description: '代码覆盖率追踪',
  config: [
    { key: 'enabled', type: 'boolean', label: '启用插件', default: true },
    { key: 'threshold', type: 'number', label: '覆盖率阈值(%)', default: 80 },
    { key: 'format', type: 'select', label: '报告格式', options: ['html', 'text', 'json', 'lcov'], default: 'html' },
  ],
});
