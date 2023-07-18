import { RowData } from '@tanstack/react-table';

declare module '@tanstack/table-core' {
  interface ColumnMeta<TData extends RowData, TValue> {
    isProblem?: boolean;
    problemId?: number;
    points?: number;
  }
}

export {};
