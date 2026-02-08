import chalk from 'chalk';
import ora, { Ora } from 'ora';

export function success(message: string): void {
  console.log(chalk.green('✓') + ' ' + message);
}

export function error(message: string): void {
  console.log(chalk.red('✗') + ' ' + message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('⚠') + ' ' + message);
}

export function info(message: string): void {
  console.log(chalk.blue('ℹ') + ' ' + message);
}

export function log(message: string): void {
  console.log(message);
}

export function dim(message: string): void {
  console.log(chalk.dim(message));
}

export function bold(message: string): string {
  return chalk.bold(message);
}

export function green(message: string): string {
  return chalk.green(message);
}

export function red(message: string): string {
  return chalk.red(message);
}

export function yellow(message: string): string {
  return chalk.yellow(message);
}

export function blue(message: string): string {
  return chalk.blue(message);
}

export function cyan(message: string): string {
  return chalk.cyan(message);
}

export function dimText(message: string): string {
  return chalk.dim(message);
}

export function spinner(message: string): Ora {
  return ora({
    text: message,
    spinner: 'dots',
  }).start();
}

// Strip ANSI escape codes to get visible string length
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function visibleLength(str: string): number {
  return str.replace(ANSI_RE, '').length;
}

function padEndVisible(str: string, width: number): string {
  const pad = width - visibleLength(str);
  return pad > 0 ? str + ' '.repeat(pad) : str;
}

export function table(headers: string[], rows: string[][]): void {
  // Calculate column widths using visible (non-ANSI) length
  const colWidths = headers.map((h, i) => {
    const maxDataWidth = Math.max(...rows.map(r => visibleLength(r[i] || '')));
    return Math.max(h.length, maxDataWidth);
  });

  // Print header
  const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join('  ');
  console.log(chalk.bold(headerRow));
  console.log(chalk.dim('-'.repeat(headerRow.length)));

  // Print rows
  for (const row of rows) {
    const rowStr = row.map((cell, i) => padEndVisible(cell || '', colWidths[i])).join('  ');
    console.log(rowStr);
  }
}

export function box(title: string, content: string): void {
  const lines = content.split('\n');
  const maxLen = Math.max(visibleLength(title), ...lines.map(l => visibleLength(l)));
  const width = maxLen + 4;

  console.log('┌' + '─'.repeat(width - 2) + '┐');
  console.log('│ ' + padEndVisible(chalk.bold(title), width - 4) + ' │');
  console.log('├' + '─'.repeat(width - 2) + '┤');
  for (const line of lines) {
    console.log('│ ' + padEndVisible(line, width - 4) + ' │');
  }
  console.log('└' + '─'.repeat(width - 2) + '┘');
}

export function requestLog(method: string, path: string, status: number, duration: number): void {
  const statusColor = status >= 200 && status < 300 ? chalk.green :
                      status >= 400 && status < 500 ? chalk.yellow :
                      status >= 500 ? chalk.red : chalk.gray;

  const methodColors: Record<string, (s: string) => string> = {
    GET: chalk.cyan,
    POST: chalk.green,
    PUT: chalk.yellow,
    PATCH: chalk.magenta,
    DELETE: chalk.red,
    HEAD: chalk.blue,
    OPTIONS: chalk.gray,
  };
  const methodColor = methodColors[method] || chalk.white;

  const timestamp = chalk.dim(new Date().toLocaleTimeString());
  const methodStr = methodColor(method.padEnd(7));
  const pathStr = chalk.white(path);
  const statusStr = statusColor(`${status}`);
  const durationStr = chalk.dim(`${duration}ms`);

  console.log(`${timestamp}   ${methodStr}  ${pathStr}  ${statusStr}  ${durationStr}`);
}
