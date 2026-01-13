import React from 'react';
import { Box as InkBox, Text } from 'ink';

interface PanelProps {
  title: string;
  children: React.ReactNode;
  width?: number | string;
  height?: number | string;
  borderColor?: string;
}

export function Panel({ title, children, width, height, borderColor = 'gray' }: PanelProps) {
  return (
    <InkBox
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      width={width}
      height={height}
      paddingX={1}
    >
      <InkBox marginBottom={1}>
        <Text bold color="cyan">{title}</Text>
      </InkBox>
      {children}
    </InkBox>
  );
}

interface StatusBadgeProps {
  status: 'success' | 'error' | 'warning' | 'info' | 'pending';
  label: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const colors: Record<string, string> = {
    success: 'green',
    error: 'red',
    warning: 'yellow',
    info: 'blue',
    pending: 'gray',
  };

  const symbols: Record<string, string> = {
    success: '●',
    error: '●',
    warning: '●',
    info: '●',
    pending: '○',
  };

  return (
    <Text color={colors[status]}>
      {symbols[status]} {label}
    </Text>
  );
}

interface TableProps {
  headers: string[];
  rows: string[][];
  columnWidths?: number[];
}

export function Table({ headers, rows, columnWidths }: TableProps) {
  const widths = columnWidths || headers.map(() => 15);

  return (
    <InkBox flexDirection="column">
      <InkBox>
        {headers.map((header, i) => (
          <InkBox key={i} width={widths[i]}>
            <Text bold dimColor>{header}</Text>
          </InkBox>
        ))}
      </InkBox>
      {rows.map((row, rowIndex) => (
        <InkBox key={rowIndex}>
          {row.map((cell, cellIndex) => (
            <InkBox key={cellIndex} width={widths[cellIndex]}>
              <Text>{cell.slice(0, widths[cellIndex] - 1)}</Text>
            </InkBox>
          ))}
        </InkBox>
      ))}
    </InkBox>
  );
}
